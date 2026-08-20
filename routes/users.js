const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db, nowLocal } = require('../db');
const { authRequired, adminRequired } = require('./middleware');
const { upload, removeUpload } = require('./upload');

function publicUser(user) {
  if (!user) return null;
  const { pin_hash, ...rest } = user;
  return rest;
}

router.get('/public', (req, res) => {
  if (req.query.role === 'admin') {
    res.json(db.prepare("SELECT id, name, photo FROM users WHERE role = 'admin' ORDER BY name").all());
    return;
  }
  res.json(db.prepare("SELECT id, name, photo FROM users WHERE name != 'Administrador' ORDER BY name").all());
});

router.get('/', authRequired, adminRequired, (req, res) => {
  res.json(
    db.prepare('SELECT id, name, email, phone, role, photo, created_at FROM users ORDER BY name').all()
  );
});

router.post('/', authRequired, adminRequired, (req, res) => {
  const { name, email, phone, pin, role } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!pin || String(pin).length < 4) {
    return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  }
  const info = db.prepare(
    'INSERT INTO users (name, email, phone, pin_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(name).trim(),
    email ? String(email).trim() : null,
    phone ? String(phone).trim() : null,
    bcrypt.hashSync(String(pin), 10),
    role === 'admin' ? 'admin' : 'user',
    nowLocal(),
    nowLocal()
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/:id', authRequired, adminRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const body = req.body || {};
  const name = body.name !== undefined && String(body.name).trim() ? String(body.name).trim() : user.name;
  const role = body.role === 'admin' || body.role === 'user' ? body.role : user.role;

  if (user.role === 'admin' && role !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'No se puede quitar el rol al último administrador' });
  }

  let hash = user.pin_hash;
  if (body.pin) {
    if (String(body.pin).length < 4) {
      return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
    }
    hash = bcrypt.hashSync(String(body.pin), 10);
  }

  db.prepare(
    'UPDATE users SET name = ?, email = ?, phone = ?, pin_hash = ?, role = ?, updated_at = ? WHERE id = ?'
  ).run(
    name,
    body.email !== undefined ? (String(body.email).trim() || null) : user.email,
    body.phone !== undefined ? (String(body.phone).trim() || null) : user.phone,
    hash,
    role,
    nowLocal(),
    user.id
  );
  res.json({ ok: true });
});

router.post('/:id/photo', authRequired, adminRequired, upload.single('photo'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Selecciona una foto' });
  removeUpload(user.photo);
  const photo = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET photo = ?, updated_at = ? WHERE id = ?').run(photo, nowLocal(), user.id);
  res.json({ photo });
});

router.delete('/:id', authRequired, adminRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'No se puede eliminar al último administrador' });
  }
  removeUpload(user.photo);
  db.prepare('DELETE FROM attendance WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

module.exports = router;
