const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authRequired, adminRequired } = require('./middleware');
const { upload, removeUpload } = require('./upload');

const PUBLIC_KEYS = ['app_name', 'default_theme', 'accent', 'logo', 'background'];

router.get('/public', (req, res) => {
  const rows = db.prepare(
    'SELECT key, value FROM settings WHERE key IN (\'app_name\', \'default_theme\', \'accent\', \'logo\', \'background\')'
  ).all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  res.json(settings);
});

router.put('/', authRequired, adminRequired, (req, res) => {
  const body = req.body || {};
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (body.app_name !== undefined && String(body.app_name).trim()) {
    set.run('app_name', String(body.app_name).trim().slice(0, 60));
  }
  if (body.default_theme === 'light' || body.default_theme === 'dark') {
    set.run('default_theme', body.default_theme);
  }
  if (body.accent && /^#[0-9a-fA-F]{6}$/.test(body.accent)) {
    set.run('accent', body.accent);
  }
  res.json({ ok: true });
});

router.post('/logo', authRequired, adminRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo' });
  removeUpload(db.prepare("SELECT value FROM settings WHERE key = 'logo'").get()?.value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('logo', `/uploads/${req.file.filename}`);
  res.json({ logo: `/uploads/${req.file.filename}` });
});

router.delete('/logo', authRequired, adminRequired, (req, res) => {
  removeUpload(db.prepare("SELECT value FROM settings WHERE key = 'logo'").get()?.value);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logo', '')").run();
  res.json({ ok: true });
});

router.post('/background', authRequired, adminRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo' });
  removeUpload(db.prepare("SELECT value FROM settings WHERE key = 'background'").get()?.value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('background', `/uploads/${req.file.filename}`);
  res.json({ background: `/uploads/${req.file.filename}` });
});

router.delete('/background', authRequired, adminRequired, (req, res) => {
  removeUpload(db.prepare("SELECT value FROM settings WHERE key = 'background'").get()?.value);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('background', '')").run();
  res.json({ ok: true });
});

module.exports = router;
