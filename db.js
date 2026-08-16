const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'control-asistencia.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function bigintFix(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

const _origPrepare = db.prepare.bind(db);
db.prepare = function (sql) {
  const stmt = _origPrepare(sql);
  const _get = stmt.get.bind(stmt);
  const _all = stmt.all.bind(stmt);
  stmt.get = (...args) => bigintFix(_get(...args));
  stmt.all = (...args) => _all(...args).map(bigintFix);
  return stmt;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    pin_hash   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    photo      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type      TEXT NOT NULL CHECK (type IN ('entrada', 'salida', 'ausencia')),
    timestamp TEXT NOT NULL,
    note      TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance(user_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(timestamp);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    channel    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getJwtSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  return secret;
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    const pin = process.env.ADMIN_PIN || '1234';
    db.prepare(
      "INSERT INTO users (name, email, phone, pin_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)"
    ).run(
      'Administrador',
      process.env.ADMIN_EMAIL || 'admin@control.app',
      process.env.ADMIN_PHONE || '',
      bcrypt.hashSync(String(pin), 10),
      nowLocal()
    );
  }
  const defaults = {
    app_name: process.env.APP_NAME || 'Control de Asistencia',
    default_theme: 'light',
    accent: '#1e6ef0',
    logo: '',
    background: '',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const key of Object.keys(defaults)) ins.run(key, defaults[key]);
}

seed();

module.exports = { db, nowLocal, getJwtSecret };
