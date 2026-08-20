const fs = require('fs');
const path = require('path');
const express = require('express');
const { db } = require('./db');

function loadEnv() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

const app = express();
app.use(express.json({ limit: '2mb' }));

function getSettings() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('app_name','default_theme','accent','logo','background')"
  ).all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  return settings;
}

app.get('/manifest.webmanifest', (req, res) => {
  const settings = getSettings();
  const name = settings.app_name || 'Control de Asistencia';
  res.json({
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: 'Registro de personal: entradas, salidas y ausencias',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: settings.default_theme === 'dark' ? '#0b1220' : '#ffffff',
    theme_color: settings.accent || '#1e6ef0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

app.use((err, req, res, next) => {
  console.error(err && err.message);
  res.status(err && err.status ? err.status : 400).json({ error: (err && err.message) || 'Error interno' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log('----------------------------------------------');
  console.log('  Control de Asistencia v2');
  console.log(`  http://localhost:${PORT}`);
  console.log('  Admin por defecto: foto "Administrador", clave 1234');
  console.log('----------------------------------------------');
});
