import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'email-agent.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER,
    email TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    message_id TEXT,
    from_name TEXT,
    from_email TEXT,
    to_email TEXT,
    subject TEXT,
    body_text TEXT,
    snippet TEXT,
    labels TEXT,
    category TEXT DEFAULT 'other',
    received_at DATETIME,
    processed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT REFERENCES emails(id),
    reply_text TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
    is_auto INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('sender', 'subject', 'body')),
    pattern TEXT NOT NULL,
    action TEXT DEFAULT 'auto_reply' CHECK (action IN ('auto_reply', 'draft', 'ignore')),
    custom_instructions TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS processed_ids (
    message_id TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Default settings
const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const defaults = {
  user_name: process.env.USER_NAME || 'User',
  user_email: process.env.USER_EMAIL || '',
  user_role: process.env.USER_ROLE || 'Professional',
  user_company: process.env.USER_COMPANY || '',
  reply_tone: process.env.REPLY_TONE || 'professional',
  reply_signature: process.env.REPLY_SIGNATURE || 'Best regards',
  poll_interval: process.env.POLL_INTERVAL_MS || '60000',
  monitoring_enabled: 'false',
  custom_instructions: '',
};
db.transaction(() => {
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
})();

export default db;
