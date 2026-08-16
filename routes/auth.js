const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const router = express.Router();
const { db, nowLocal, getJwtSecret } = require('../db');
const { checkLockout, failAttempt, clearAttempts, authRequired } = require('./middleware');
const { upload, removeUpload } = require('./upload');

function findUserByPhone(contact) {
  const digits = contact.replace(/\D/g, '');
  if (!digits) return null;
  const rows = db.prepare('SELECT * FROM users WHERE phone IS NOT NULL AND phone != ?').all('');
  return rows.find((u) => u.phone.replace(/\D/g, '') === digits) || null;
}

function publicUser(user) {
  if (!user) return null;
  const { pin_hash, ...rest } = user;
  return rest;
}

router.post('/login', (req, res) => {
  const { userId, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });

  const wait = checkLockout(user.id);
  if (wait > 0) {
    return res.status(429).json({ error: `Demasiados intentos. Intenta en ${Math.ceil(wait / 1000)} s.` });
  }
  if (!pin || !bcrypt.compareSync(String(pin), user.pin_hash)) {
    failAttempt(user.id);
    return res.status(400).json({ error: 'Clave incorrecta' });
  }
  clearAttempts(user.id);
  const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  res.json(publicUser(req.user));
});

router.post('/change-pin', (req, res) => {
  const { userId, oldPin, newPin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
  if (!oldPin || !bcrypt.compareSync(String(oldPin), user.pin_hash)) {
    return res.status(400).json({ error: 'Clave actual incorrecta' });
  }
  if (!newPin || String(newPin).length < 4) {
    return res.status(400).json({ error: 'La nueva clave debe tener al menos 4 caracteres' });
  }
  db.prepare('UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(newPin), 10), nowLocal(), user.id);
  res.json({ ok: true });
});

router.post('/me/photo', authRequired, upload.single('photo'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona una foto' });
  removeUpload(user.photo);
  const photo = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET photo = ?, updated_at = ? WHERE id = ?').run(photo, nowLocal(), user.id);
  res.json({ photo });
});

router.post('/recover', async (req, res) => {
  const contact = String((req.body || {}).contact || '').trim().toLowerCase();
  if (!contact) return res.status(400).json({ error: 'Ingresa tu email o teléfono registrado' });

  const isEmail = contact.includes('@');
  let user;
  if (isEmail) {
    user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(contact);
  } else {
    user = findUserByPhone(contact);
  }
  if (!user) return res.status(404).json({ error: 'No se encontró un usuario con ese email o teléfono' });
  if (!user.email) return res.status(400).json({ error: 'Este usuario no tiene un email registrado para recibir el código' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO recovery_codes (user_id, code, channel, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, code, 'email', expiresAt, nowLocal());

  let emailStatus = 'not_configured';
  if (process.env.SMTP_HOST) {
    try {
      await sendRecoveryEmail(user.email, code, user.name);
      emailStatus = 'sent';
    } catch (err) {
      console.error('Email no enviado:', err.message);
      emailStatus = 'error';
    }
  }

  let isAdmin = false;
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const payload = require('jsonwebtoken').verify(token, getJwtSecret());
      const u = db.prepare('SELECT role FROM users WHERE id = ?').get(payload.userId);
      if (u && u.role === 'admin') isAdmin = true;
    }
  } catch (_) { /* not logged in or invalid token */ }

  res.json({
    channel: 'email',
    sentTo: user.email,
    emailStatus,
    devCode: isAdmin ? code : undefined,
  });
});

function sendRecoveryEmail(to, code, name) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return transporter.sendMail({
    from,
    to,
    subject: 'Tu código de recuperación - ' + (process.env.APP_NAME || 'Control de Asistencia'),
    text: `Hola ${name},\n\nTu código de recuperación es: ${code}\nVálido por 10 minutos.\n\nSi no solicitaste esto, ignora este mensaje.`,
    html: `<p>Hola <b>${name}</b>,</p><p>Tu código de recuperación es: <b>${code}</b></p><p>Válido por 10 minutos.</p>`,
  });
}

router.post('/reset-pin', (req, res) => {
  const { contact, code, newPin } = req.body || {};
  const cc = String(contact || '').trim().toLowerCase();
  if (!cc || !code || !newPin) return res.status(400).json({ error: 'Datos incompletos' });
  if (String(newPin).length < 4) return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });

  const isEmail = cc.includes('@');
  let user;
  if (isEmail) user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(cc);
  else user = findUserByPhone(cc);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const rec = db.prepare(
    'SELECT * FROM recovery_codes WHERE user_id = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(user.id, String(code).trim());
  if (!rec) return res.status(400).json({ error: 'Código inválido' });
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'El código ha expirado' });
  }

  db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(rec.id);
  db.prepare('UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(newPin), 10), nowLocal(), user.id);
  res.json({ ok: true });
});

module.exports = router;
