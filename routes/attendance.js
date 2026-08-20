const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db, nowLocal } = require('../db');
const { checkLockout, failAttempt, clearAttempts, authRequired, adminRequired } = require('./middleware');

const TYPES = ['entrada', 'salida', 'ausencia'];

function parseTs(ts) {
  const [d, t] = ts.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, s);
}

function computeHoursForDay(records) {
  let totalMs = 0;
  let lastEntry = null;
  for (const r of records) {
    if (r.type === 'entrada') {
      lastEntry = parseTs(r.timestamp);
    } else if (r.type === 'salida' && lastEntry) {
      totalMs += parseTs(r.timestamp).getTime() - lastEntry.getTime();
      lastEntry = null;
    }
  }
  const totalMin = Math.max(0, Math.floor(totalMs / 60000));
  const h = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const m = String(totalMin % 60).padStart(2, '0');
  return h + ':' + m;
}

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
  const rows = db.prepare(sql).all(...params);
  const byUserDay = {};
  for (const r of rows) {
    const key = r.user_id + '_' + r.timestamp.slice(0, 10);
    if (!byUserDay[key]) byUserDay[key] = [];
    byUserDay[key].push(r);
  }
  for (const key of Object.keys(byUserDay)) {
    const sorted = [...byUserDay[key]].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const hours = computeHoursForDay(sorted);
    for (const r of byUserDay[key]) r.hours_worked = hours;
  }
  res.json(rows);
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
  const byUserDay = {};
  for (const r of rows) {
    const key = r.user_id + '_' + r.timestamp.slice(0, 10);
    if (!byUserDay[key]) byUserDay[key] = [];
    byUserDay[key].push(r);
  }
  for (const key of Object.keys(byUserDay)) {
    const sorted = [...byUserDay[key]].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const hours = computeHoursForDay(sorted);
    for (const r of byUserDay[key]) r.hours_worked = hours;
  }
  const esc = (v) => {
    v = v == null ? '' : String(v);
    return `"${v.replace(/"/g, '""')}"`;
  };
  const header = 'Fecha;Hora;Usuario;Tipo;Nota;Horas trabajadas';
  const lines = rows.map((r) =>
    [r.timestamp.slice(0, 10), r.timestamp.slice(11, 19), r.user_name, r.type, r.note || '', r.hours_worked || '00:00']
      .map(esc)
      .join(';')
  );
  const csv = '\uFEFF' + [header, ...lines].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="asistencia_${nowLocal().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get('/user-summary', authRequired, adminRequired, (req, res) => {
  const { userId, month } = req.query;
  if (!userId || !month) return res.status(400).json({ error: 'userId and month required' });
  const from = month + '-01';
  const [y, mo] = month.split('-').map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const to = month + '-' + String(lastDay).padStart(2, '0');
  const rows = db.prepare(
    'SELECT a.user_id, a.type, a.timestamp FROM attendance a WHERE a.user_id = ? AND date(a.timestamp) >= ? AND date(a.timestamp) <= ? ORDER BY a.timestamp'
  ).all(Number(userId), from, to);
  const byDate = {};
  for (const r of rows) {
    const d = r.timestamp.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  }
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = month + '-' + String(d).padStart(2, '0');
    const recs = byDate[dateStr] || [];
    let status = 'none';
    let hours = '00:00';
    if (recs.length) {
      const last = recs[recs.length - 1];
      if (last.type === 'ausencia') status = 'ausencia';
      else if (recs.some((r) => r.type === 'entrada')) status = 'presente';
      hours = computeHoursForDay(recs);
    }
    days.push({ date: dateStr, day: d, status, hours });
  }
  const present = days.filter((d) => d.status === 'presente').length;
  const absent = days.filter((d) => d.status === 'ausencia').length;
  const unmarked = days.filter((d) => d.status === 'none').length;
  res.json({ days, present, absent, unmarked });
});

module.exports = router;
