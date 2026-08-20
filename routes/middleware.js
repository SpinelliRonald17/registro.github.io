const jwt = require('jsonwebtoken');
const { db, getJwtSecret } = require('../db');

const attempts = new Map();

function checkLockout(userId) {
  const a = attempts.get(userId);
  if (a && a.until && Date.now() < a.until) return a.until - Date.now();
  return 0;
}

function failAttempt(userId) {
  const a = attempts.get(userId) || { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= 5) {
    a.until = Date.now() + 15 * 60 * 1000;
    a.fails = 0;
  }
  attempts.set(userId, a);
}

function clearAttempts(userId) {
  attempts.delete(userId);
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'No autorizado' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Requiere permisos de administrador' });
  }
  next();
}

module.exports = { checkLockout, failAttempt, clearAttempts, authRequired, adminRequired };
