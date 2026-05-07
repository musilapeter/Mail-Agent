import { google } from 'googleapis';
import db from '../config/database.js';

class GmailService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.gmail = null;
    this._loadTokens();
    this.oauth2Client.on('tokens', (t) => this._saveTokens(t));
  }

  _loadTokens() {
    const row = db.prepare('SELECT * FROM tokens WHERE id = 1').get();
    if (row?.access_token) {
      this.oauth2Client.setCredentials({
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        expiry_date: row.expiry_date,
      });
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    }
  }

  _saveTokens(tokens) {
    const existing = db.prepare('SELECT 1 FROM tokens WHERE id = 1').get();
    if (existing) {
      db.prepare(`UPDATE tokens SET
        access_token = COALESCE(?, access_token),
        refresh_token = COALESCE(?, refresh_token),
        expiry_date = COALESCE(?, expiry_date),
        updated_at = CURRENT_TIMESTAMP WHERE id = 1`
      ).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);
    } else {
      db.prepare('INSERT INTO tokens (id, access_token, refresh_token, expiry_date) VALUES (1,?,?,?)')
        .run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);
    }
  }

  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async handleCallback(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this._saveTokens(tokens);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    const profile = await this.gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;
    db.prepare('UPDATE tokens SET email = ? WHERE id = 1').run(email);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('user_email', email);
    return email;
  }

  isAuthenticated() {
    const row = db.prepare('SELECT access_token FROM tokens WHERE id = 1').get();
    return !!(row?.access_token);
  }

  getUserEmail() {
    return db.prepare('SELECT email FROM tokens WHERE id = 1').get()?.email || null;
  }

  async listUnreadMessages(maxResults = 20) {
    if (!this.gmail) throw new Error('Gmail not authenticated');
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread -category:promotions -category:social',
      maxResults,
    });
    return res.data.messages || [];
  }

  async getMessage(messageId) {
    if (!this.gmail) throw new Error('Gmail not authenticated');
    const res = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    return this._parseMessage(res.data);
  }

  _parseMessage(msg) {
    const headers = msg.payload.headers;
    const h = (name) => headers.find(x => x.name.toLowerCase() === name.toLowerCase())?.value || '';
    const fromRaw = h('From');
    const m = fromRaw.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);

    let bodyText = '', bodyHtml = '';
    const extract = (part) => {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body?.data)
        bodyText = Buffer.from(part.body.data, 'base64url').toString('utf-8');
      if (part.mimeType === 'text/html' && part.body?.data)
        bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8');
      if (part.parts) part.parts.forEach(extract);
    };
    extract(msg.payload);
    if (!bodyText && !bodyHtml && msg.payload.body?.data) {
      const dec = Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8');
      bodyText = dec;
    }
    if (!bodyText && bodyHtml) bodyText = bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    return {
      id: msg.id, threadId: msg.threadId,
      messageId: h('Message-ID') || h('Message-Id'),
      from: { name: m?.[1]?.trim() || fromRaw, email: m?.[2]?.trim() || fromRaw },
      to: h('To'), subject: h('Subject'),
      bodyText, snippet: msg.snippet,
      labels: msg.labelIds || [],
      receivedAt: new Date(parseInt(msg.internalDate)),
    };
  }

  async sendReply(to, subject, bodyText, threadId, inReplyTo) {
    if (!this.gmail) throw new Error('Gmail not authenticated');
    const userEmail = this.getUserEmail();
    const subj = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const raw = [
      `From: ${userEmail}`, `To: ${to}`, `Subject: ${subj}`,
      `In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`,
      'Content-Type: text/plain; charset=utf-8', '', bodyText,
    ].join('\r\n');
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: Buffer.from(raw).toString('base64url'), threadId },
    });
    return res.data;
  }

  async markAsRead(messageId) {
    if (!this.gmail) throw new Error('Gmail not authenticated');
    await this.gmail.users.messages.modify({
      userId: 'me', id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  async disconnect() {
    db.prepare('DELETE FROM tokens WHERE id = 1').run();
    try { await this.oauth2Client.revokeCredentials(); } catch {}
    this.gmail = null;
  }
}

export const gmailService = new GmailService();
