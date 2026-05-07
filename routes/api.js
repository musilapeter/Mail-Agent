import { Router } from 'express';
import db from '../config/database.js';
import { gmailService } from '../services/gmail.service.js';
import { monitorService } from '../services/monitor.service.js';

const router = Router();

// --- Status & Stats ---
router.get('/status', (req, res) => {
  res.json(monitorService.getStatus());
});

router.get('/stats', (req, res) => {
  const totalEmails = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
  const pendingDrafts = db.prepare("SELECT COUNT(*) as c FROM drafts WHERE status = 'pending'").get().c;
  const sentReplies = db.prepare("SELECT COUNT(*) as c FROM drafts WHERE status = 'sent'").get().c;
  const autoReplied = db.prepare("SELECT COUNT(*) as c FROM drafts WHERE is_auto = 1 AND status = 'sent'").get().c;
  const activeRules = db.prepare('SELECT COUNT(*) as c FROM rules WHERE enabled = 1').get().c;
  res.json({ totalEmails, pendingDrafts, sentReplies, autoReplied, activeRules });
});

// --- Monitor ---
router.post('/monitor/start', (req, res) => {
  try { monitorService.start(); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/monitor/stop', (req, res) => {
  monitorService.stop(); res.json({ success: true });
});

// --- Emails ---
router.get('/emails', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const emails = db.prepare('SELECT * FROM emails ORDER BY received_at DESC LIMIT ? OFFSET ?')
    .all(parseInt(limit), parseInt(offset));
  const total = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
  res.json({ emails, total });
});
router.get('/emails/:id', (req, res) => {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });
  res.json(email);
});

// --- Drafts ---
router.get('/drafts', (req, res) => {
  const { status = 'pending' } = req.query;
  const q = status === 'all'
    ? 'SELECT d.*, e.from_name, e.from_email, e.subject, e.snippet, e.body_text, e.received_at, e.category FROM drafts d JOIN emails e ON d.email_id = e.id ORDER BY d.created_at DESC'
    : 'SELECT d.*, e.from_name, e.from_email, e.subject, e.snippet, e.body_text, e.received_at, e.category FROM drafts d JOIN emails e ON d.email_id = e.id WHERE d.status = ? ORDER BY d.created_at DESC';
  const drafts = status === 'all' ? db.prepare(q).all() : db.prepare(q).all(status);
  res.json(drafts);
});
router.put('/drafts/:id', (req, res) => {
  const { reply_text } = req.body;
  db.prepare('UPDATE drafts SET reply_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(reply_text, req.params.id);
  res.json({ success: true });
});
router.post('/drafts/:id/approve', async (req, res) => {
  try {
    const draft = db.prepare('SELECT d.*, e.from_email, e.subject, e.thread_id, e.message_id FROM drafts d JOIN emails e ON d.email_id = e.id WHERE d.id = ?').get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Not found' });

    await gmailService.sendReply(draft.from_email, draft.subject, draft.reply_text, draft.thread_id, draft.message_id);
    await gmailService.markAsRead(draft.email_id);
    db.prepare("UPDATE drafts SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(draft.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/drafts/:id/reject', (req, res) => {
  db.prepare("UPDATE drafts SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// --- Rules ---
router.get('/rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM rules ORDER BY created_at DESC').all());
});
router.post('/rules', (req, res) => {
  const { name, type, pattern, action, custom_instructions } = req.body;
  const info = db.prepare('INSERT INTO rules (name, type, pattern, action, custom_instructions) VALUES (?,?,?,?,?)')
    .run(name, type, pattern, action || 'auto_reply', custom_instructions || '');
  res.json({ id: info.lastInsertRowid });
});
router.put('/rules/:id', (req, res) => {
  const { name, type, pattern, action, custom_instructions, enabled } = req.body;
  db.prepare('UPDATE rules SET name=?, type=?, pattern=?, action=?, custom_instructions=?, enabled=? WHERE id=?')
    .run(name, type, pattern, action, custom_instructions || '', enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});
router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Settings ---
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});
router.put('/settings', (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) stmt.run(k, v);
  })();
  res.json({ success: true });
});

export default router;
