import db from '../config/database.js';
import { gmailService } from './gmail.service.js';
import { geminiService } from './gemini.service.js';

class MonitorService {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.lastCheck = null;
    this.stats = { checked: 0, drafted: 0, autoReplied: 0, errors: 0 };
  }

  _getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    return s;
  }

  _getRules() {
    return db.prepare('SELECT * FROM rules WHERE enabled = 1').all();
  }

  start() {
    if (this.isRunning) return;
    if (!gmailService.isAuthenticated()) throw new Error('Gmail not connected');

    const settings = this._getSettings();
    const interval = parseInt(settings.poll_interval) || 60000;

    this.isRunning = true;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_enabled', 'true')").run();
    console.log(`📬 Monitor started (every ${interval / 1000}s)`);

    this._poll();
    this.interval = setInterval(() => this._poll(), interval);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.isRunning = false;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_enabled', 'false')").run();
    console.log('📭 Monitor stopped');
  }

  async _poll() {
    try {
      const messages = await gmailService.listUnreadMessages(10);
      this.lastCheck = new Date();
      this.stats.checked++;

      for (const msg of messages) {
        if (db.prepare('SELECT 1 FROM processed_ids WHERE message_id = ?').get(msg.id)) continue;
        await this._processEmail(msg.id);
      }
    } catch (err) {
      this.stats.errors++;
      console.error('Poll error:', err.message);
    }
  }

  async _processEmail(id) {
    try {
      const email = await gmailService.getMessage(id);
      // Skip own emails
      const userEmail = gmailService.getUserEmail();
      if (email.from.email === userEmail) {
        db.prepare('INSERT OR IGNORE INTO processed_ids (message_id) VALUES (?)').run(id);
        return;
      }

      // Save email
      db.prepare(`INSERT OR IGNORE INTO emails (id, thread_id, message_id, from_name, from_email,
        to_email, subject, body_text, snippet, labels, received_at, processed)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`).run(
        email.id, email.threadId, email.messageId, email.from.name, email.from.email,
        email.to, email.subject, email.bodyText, email.snippet,
        JSON.stringify(email.labels), email.receivedAt.toISOString()
      );

      // Categorize
      let category = 'other';
      try {
        category = await geminiService.categorizeEmail(email);
        db.prepare('UPDATE emails SET category = ? WHERE id = ?').run(category, email.id);
      } catch {}

      // Check rules
      const rules = this._getRules();
      let matchedRule = null;
      for (const rule of rules) {
        const pat = rule.pattern.toLowerCase();
        const matchField = rule.type === 'sender' ? email.from.email
          : rule.type === 'subject' ? email.subject
          : email.bodyText;
        if (matchField?.toLowerCase().includes(pat)) { matchedRule = rule; break; }
      }

      // Determine action
      const action = matchedRule?.action || (category === 'support' ? 'auto_reply' : 'draft');
      const settings = this._getSettings();
      const customInst = matchedRule?.custom_instructions || settings.custom_instructions || '';

      // Generate reply
      const replyText = await geminiService.generateReply(email, settings, customInst);

      if (action === 'auto_reply') {
        // Send immediately
        await gmailService.sendReply(email.from.email, email.subject, replyText, email.threadId, email.messageId);
        await gmailService.markAsRead(email.id);
        db.prepare('INSERT INTO drafts (email_id, reply_text, status, is_auto) VALUES (?,?,?,?)')
          .run(email.id, replyText, 'sent', 1);
        this.stats.autoReplied++;
        console.log(`✅ Auto-replied to: ${email.subject}`);
      } else if (action === 'draft') {
        db.prepare('INSERT INTO drafts (email_id, reply_text, status, is_auto) VALUES (?,?,?,?)')
          .run(email.id, replyText, 'pending', 0);
        this.stats.drafted++;
        console.log(`📝 Draft created for: ${email.subject}`);
      }
      // 'ignore' action: do nothing

      db.prepare('INSERT OR IGNORE INTO processed_ids (message_id) VALUES (?)').run(id);
    } catch (err) {
      this.stats.errors++;
      console.error(`Error processing ${id}:`, err.message);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCheck: this.lastCheck,
      stats: this.stats,
      authenticated: gmailService.isAuthenticated(),
      email: gmailService.getUserEmail(),
    };
  }
}

export const monitorService = new MonitorService();
