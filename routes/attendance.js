const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db, nowLocal } = require('../db');
const { checkLockout, failAttempt, clearAttempts, authRequired, adminRequired } = require('./middleware');

const TYPES = ['entrada', 'salida', 'ausencia'];

router.post('/mark', (req, res) => {
  const { userId, pin, type, note } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de registro inválido' });

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

  const timestamp = nowLocal();
  const info = db.prepare(
    'INSERT INTO attendance (user_id, type, timestamp, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(user.id, type, timestamp, note ? String(note).slice(0, 200) : null, timestamp);

  const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ ok: true, record });
});

router.get('/today', (req, res) => {
  const today = nowLocal().slice(0, 10);
  const rows = db.prepare(
    'SELECT id, user_id, type, timestamp, note FROM attendance WHERE date(timestamp) = ? ORDER BY timestamp'
  ).all(today);
  res.json(rows);
});

function buildHistoryQuery(query) {
  let sql =
    'SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id WHERE 1 = 1';
  const params = [];
  if (query.from) {
    sql += ' AND date(a.timestamp) >= ?';
    params.push(query.from);
  }
  if (query.to) {
    sql += ' AND date(a.timestamp) <= ?';
    params.push(query.to);
  }
  if (query.userId) {
    sql += ' AND a.user_id = ?';
    params.push(Number(query.userId));
  }
  if (query.type) {
    sql += ' AND a.type = ?';
    params.push(query.type);
  }
  sql += ' ORDER BY a.timestamp DESC';
  return { sql, params };
}

router.get('/history', authRequired, adminRequired, (req, res) => {
  const { sql, params } = buildHistoryQuery(req.query);
  if (req.query.limit) sql += ` LIMIT ${Math.max(1, Math.min(500, Number(req.query.limit)))}`;
  res.json(db.prepare(sql).all(...params));
});

router.put('/history/:id', authRequired, adminRequired, (req, res) => {
  const rec = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Registro no encontrado' });
  const body = req.body || {};
  const type = TYPES.includes(body.type) ? body.type : rec.type;
  const timestamp = body.timestamp || rec.timestamp;
  const note = body.note !== undefined ? String(body.note).slice(0, 200) : rec.note;
  db.prepare('UPDATE attendance SET type = ?, timestamp = ?, note = ? WHERE id = ?')
    .run(type, timestamp, note, rec.id);
  res.json({ ok: true });
});

router.delete('/history/:id', authRequired, adminRequired, (req, res) => {
  const info = db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ ok: true });
});

router.get('/export', authRequired, adminRequired, (req, res) => {
  const { sql, params } = buildHistoryQuery(req.query);
  const rows = db.prepare(sql).all(...params);
  const esc = (v) => {
    v = v == null ? '' : String(v);
    return `"${v.replace(/"/g, '""')}"`;
  };
  const header = 'Fecha;Hora;Usuario;Tipo;Nota';
  const lines = rows.map((r) =>
    [r.timestamp.slice(0, 10), r.timestamp.slice(11, 19), r.user_name, r.type, r.note || '']
      .map(esc)
      .join(';')
  );
  const csv = '\uFEFF' + [header, ...lines].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="asistencia_${nowLocal().slice(0, 10)}.csv"`);
  res.send(csv);
});

module.exports = router;
