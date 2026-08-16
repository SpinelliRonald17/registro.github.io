window.DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
      '<rect width="128" height="128" rx="24" fill="#d1d5db"/>' +
      '<circle cx="64" cy="46" r="20" fill="#9ca3af"/>' +
      '<path d="M24 122c4-24 21-37 40-37s36 13 40 37z" fill="#9ca3af"/>' +
      '</svg>'
  );

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  users: [],
  allUsers: [],
  settings: {},
  today: [],
  me: (() => {
    try { return JSON.parse(localStorage.getItem('ca_me') || 'null'); } catch (e) { return null; }
  })(),
  token: localStorage.getItem('ca_token'),
  selectedUser: null,
  pendingPin: null,
  pickMode: null,
  adminTab: 'dashboard',
  historyFilters: {},
  historyRows: [],
};

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || 'Error');
  return data;
}

let toastTimer = null;
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', type === 'err');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

function openModal(id) { $('#' + id).classList.add('open'); }
function closeModal(id) { $('#' + id).classList.remove('open'); }
function closeAllModals() { $$('.modal').forEach((m) => m.classList.remove('open')); }

function typeLabel(type) {
  return { entrada: 'Entrada', salida: 'Salida', ausencia: 'Ausencia' }[type] || type;
}

function fmtDate(ts) {
  const p = String(ts).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ts;
}

function avatarEl(user, size) {
  const img = document.createElement('img');
  img.className = 'avatar';
  img.width = size;
  img.height = size;
  img.alt = user.name || '';
  img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR; };
  img.src = user.photo || DEFAULT_AVATAR;
  return img;
}

function avatarHTML(user, size) {
  return `<img class="avatar" width="${size}" height="${size}" alt="${esc(user.name || '')}" src="${esc(user.photo || DEFAULT_AVATAR)}" onerror="this.onerror=null;this.src=DEFAULT_AVATAR;">`;
}

async function loadSettings() {
  state.settings = await api('/api/settings/public');
}

async function loadPublic() {
  state.users = await api('/api/users/public');
}

async function loadToday() {
  state.today = await api('/api/attendance/today');
}

function applyBrand() {
  const name = state.settings.app_name || 'Control de Asistencia';
  $('#brand-name').textContent = name;
  document.title = name;
  const logoImg = $('#brand-logo');
  if (state.settings.logo) {
    logoImg.src = state.settings.logo;
    logoImg.hidden = false;
  } else {
    logoImg.hidden = true;
  }
  document.body.style.backgroundImage = state.settings.background ? `url('${state.settings.background}')` : 'none';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = state.settings.accent || '#1e6ef0';
  document.documentElement.style.setProperty('--primary', state.settings.accent || '#1e6ef0');
}

function setupTheme() {
  const stored = localStorage.getItem('ca_theme');
  const def = state.settings.default_theme || 'light';
  const pref = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(stored || def || pref);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  $('#icon-sun').hidden = theme === 'light';
  $('#icon-moon').hidden = theme !== 'light';
}

function toggleTheme() {
  const next = (document.body.dataset.theme || 'light') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ca_theme', next);
  applyTheme(next);
}

function statusFor(userId) {
  const recs = state.today.filter((r) => r.user_id === userId);
  if (!recs.length) return { text: 'Sin marcar', cls: 'none' };
  const last = recs[recs.length - 1];
  if (last.type === 'salida') return { text: 'Salida ' + last.timestamp.slice(11, 16), cls: 'salida' };
  if (last.type === 'entrada') return { text: 'Entrada ' + last.timestamp.slice(11, 16), cls: 'entrada' };
  return { text: 'Ausencia', cls: 'ausencia' };
}

function renderMarking() {
  const grid = $('#user-grid');
  grid.innerHTML = '';
  if (!state.users.length) {
    grid.innerHTML = '<p class="muted">Aún no hay usuarios registrados. El administrador debe crearlos desde el Panel admin.</p>';
    lastGridKey = gridKey();
    return;
  }
  state.users.forEach((u) => {
    const st = statusFor(u.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'user-card';
    card.onclick = () => openPin(u);
    const img = avatarEl(u, 96);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = u.name;
    const chip = document.createElement('span');
    chip.className = 'chip ' + st.cls;
    chip.textContent = st.text;
    card.append(img, name, chip);
    grid.appendChild(card);
  });
  lastGridKey = gridKey();
}

function openPin(user) {
  state.selectedUser = user;
  $('#pin-user').textContent = user.name;
  const av = $('#pin-avatar');
  av.innerHTML = '';
  av.appendChild(avatarEl(user, 80));
  $('#pin-input').value = '';
  $('#pin-error').hidden = true;
  openModal('pin-modal');
  setTimeout(() => $('#pin-input').focus(), 60);
}

async function submitPin() {
  const user = state.selectedUser;
  const pin = $('#pin-input').value;
  if (!user) return;
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, pin }),
    });
    state.token = data.token;
    state.pendingPin = pin;
    state.me = data.user;
    state.selectedUser = data.user;
    localStorage.setItem('ca_me', JSON.stringify(data.user));
    localStorage.setItem('ca_token', data.token);
    $('#btn-logout').hidden = false;
    closeModal('pin-modal');
    setupInactivity();
    updateLoggedUser();

    if (state.pickMode === 'admin') {
      state.pickMode = null;
      if (data.user.role === 'admin') showAdmin();
      else toast('No tienes permisos de administrador', 'err');
    } else if (state.pickMode === 'profile') {
      state.pickMode = null;
      openProfile();
    } else {
      openActions();
    }
  } catch (e) {
    const err = $('#pin-error');
    err.textContent = e.message;
    err.hidden = false;
  }
}

function openActions() {
  const user = state.selectedUser;
  $('#act-user').textContent = user.name;
  const av = $('#act-avatar');
  av.innerHTML = '';
  av.appendChild(avatarEl(user, 80));
  $('#act-note').value = '';
  const adminBtn = $('#btn-act-admin');
  adminBtn.hidden = !(state.me && state.me.role === 'admin');
  openModal('actions-modal');
}

async function markAttendance(type) {
  const user = state.selectedUser;
  try {
    await api('/api/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({
        userId: user.id,
        pin: state.pendingPin,
        type,
        note: $('#act-note').value,
      }),
    });
    toast('Registro: ' + typeLabel(type));
    closeAllModals();
    await loadToday();
    renderMarking();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function headerProfile() {
  if (state.me) {
    state.selectedUser = state.me;
    openProfile();
  } else {
    openPick('profile');
  }
}

function headerAdmin() {
  if (state.me && state.me.role === 'admin') showAdmin();
  else openPick('admin');
}

function headerLogout() {
  stopInactivity();
  state.token = null;
  state.me = null;
  state.pendingPin = null;
  state.selectedUser = null;
  localStorage.removeItem('ca_token');
  localStorage.removeItem('ca_me');
  location.reload();
}

function updateLoggedUser() {
  const el = $('#logged-user');
  if (state.me) {
    const avatar = $('#logged-avatar');
    avatar.src = state.me.photo || DEFAULT_AVATAR;
    avatar.onerror = () => { avatar.onerror = null; avatar.src = DEFAULT_AVATAR; };
    $('#logged-name').textContent = state.me.name;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function openPick(mode) {
  state.pickMode = mode;
  $('#pick-title').textContent =
    mode === 'admin'
      ? 'Selecciona un administrador para entrar al panel.'
      : 'Selecciona tu perfil para gestionar tu foto y clave.';
  const list = $('#pick-list');
  list.innerHTML = '<p class="muted">Cargando…</p>';
  let candidates = [];
  try {
    if (mode === 'admin') {
      candidates = await api('/api/users/public?role=admin');
    } else {
      if (!state.users.length) await loadPublic();
      candidates = state.users;
    }
  } catch (e) {
    list.innerHTML = '<p class="error">No se pudo cargar la lista de usuarios.</p>';
    openModal('pick-modal');
    return;
  }
  list.innerHTML = '';
  if (!candidates.length) {
    list.innerHTML =
      '<p class="muted">No hay ' + (mode === 'admin' ? 'administradores' : 'usuarios') + ' disponibles.</p>';
  } else {
    candidates.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick-item';
      btn.appendChild(avatarEl(u, 44));
      const span = document.createElement('span');
      span.textContent = u.name;
      btn.appendChild(span);
      btn.onclick = () => {
        closeModal('pick-modal');
        openPin(u);
      };
      list.appendChild(btn);
    });
  }
  openModal('pick-modal');
}

function openProfile() {
  const user = state.selectedUser;
  $('#prof-name').textContent = user.name;
  const av = $('#prof-avatar');
  av.innerHTML = '';
  av.appendChild(avatarEl(user, 80));
  $('#prof-file').value = '';
  $('#cp-old').value = '';
  $('#cp-new').value = '';
  $('#cp-confirm').value = '';
  openModal('profile-modal');
}

async function uploadMyPhoto() {
  const user = state.selectedUser;
  const file = $('#prof-file').files[0];
  if (!file) return toast('Selecciona una foto', 'err');
  const fd = new FormData();
  fd.append('pin', state.pendingPin);
  fd.append('photo', file);
  try {
    const data = await api('/api/auth/me/photo', { method: 'POST', body: fd });
    toast('Foto actualizada');
    user.photo = data.photo;
    if (state.me) state.me.photo = data.photo;
    localStorage.setItem('ca_me', JSON.stringify(state.me));
    closeModal('profile-modal');
    await refreshBase();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function changePin() {
  const user = state.selectedUser;
  const oldPin = $('#cp-old').value || state.pendingPin;
  const newPin = $('#cp-new').value;
  const confirm = $('#cp-confirm').value;
  if (!newPin || newPin.length < 4) return toast('La nueva clave debe tener al menos 4 caracteres', 'err');
  if (newPin !== confirm) return toast('Las claves no coinciden', 'err');
  try {
    await api('/api/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, oldPin, newPin }),
    });
    state.pendingPin = newPin;
    toast('Clave actualizada');
    $('#cp-old').value = '';
    $('#cp-new').value = '';
    $('#cp-confirm').value = '';
  } catch (e) {
    toast(e.message, 'err');
  }
}

function openRecovery() {
  state.recoveryStep = 1;
  showRecoveryStep();
  openModal('recovery-modal');
}

function showRecoveryStep() {
  $('#rec-step1').hidden = state.recoveryStep !== 1;
  $('#rec-step2').hidden = state.recoveryStep !== 2;
}

function backRecovery() {
  state.recoveryStep = 1;
  showRecoveryStep();
}

async function submitRecovery() {
  const contact = $('#rec-contact').value.trim();
  if (!contact) return toast('Ingresa tu email o teléfono', 'err');
  try {
    const data = await api('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ contact }),
    });
    $('#rec-info').textContent = `Se envió el código a ${data.sentTo || 'tu cuenta'}.`;
    $('#rec-dev').hidden = !data.devCode;
    $('#rec-dev-code').textContent = data.devCode || '';
    state.recoveryContact = contact;
    state.recoveryStep = 2;
    showRecoveryStep();
  } catch (e) {
    const r = $('#rec-result');
    r.textContent = e.message;
    r.hidden = false;
  }
}

async function submitReset() {
  const code = $('#rec-code').value.trim();
  const newPin = $('#rec-new').value;
  const confirm = $('#rec-confirm').value;
  if (!code) return toast('Ingresa el código', 'err');
  if (!newPin || newPin.length < 4) return toast('La nueva clave debe tener al menos 4 caracteres', 'err');
  if (newPin !== confirm) return toast('Las claves no coinciden', 'err');
  try {
    await api('/api/auth/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ contact: state.recoveryContact, code, newPin }),
    });
    toast('Clave restablecida');
    closeModal('recovery-modal');
    state.recoveryStep = 1;
    showRecoveryStep();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function showAdmin() {
  if (!state.me || state.me.role !== 'admin') return;
  closeAllModals();
  $('#btn-logout').hidden = false;
  $('#view-marking').hidden = true;
  $('#view-admin').hidden = false;
  openAdminTab(state.adminTab);
}

function hideAdmin() {
  $('#view-admin').hidden = true;
  $('#view-marking').hidden = false;
  window.scrollTo(0, 0);
  autoRefresh();
}

function openAdminTab(tab) {
  state.adminTab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + tab));
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'history') {
    fillHistoryUsers();
    loadHistory();
  }
  if (tab === 'settings') fillSettings();
}

async function loadDashboard() {
  try {
    await Promise.all([loadAdminUsers(), loadToday()]);
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const entrances = new Set(state.today.filter((r) => r.type === 'entrada').map((r) => r.user_id));
  const absences = new Set(state.today.filter((r) => r.type === 'ausencia').map((r) => r.user_id));
  const total = state.allUsers.length;
  const present = state.allUsers.filter((u) => entrances.has(u.id)).length;
  const absent = state.allUsers.filter((u) => absences.has(u.id)).length;
  const unmarked = total - present - absent;
  $('#stat-total').textContent = total;
  $('#stat-present').textContent = present;
  $('#stat-absent').textContent = absent;
  $('#stat-unmarked').textContent = unmarked;

  const hourCounts = Array.from({ length: 24 }, (_, h) => ({
    h,
    n: state.today.filter((r) => r.type === 'entrada' && Number(r.timestamp.slice(11, 13)) === h).length,
  }));
  const max = Math.max(1, ...hourCounts.map((x) => x.n));
  const visible = hourCounts.filter((x) => x.n > 0);
  $('#hour-bars').innerHTML = visible.length
    ? visible
        .map(
          (x) =>
            `<div class="hbar"><span class="hbar-label">${String(x.h).padStart(2, '0')}:00</span>` +
            `<div class="hbar-track"><div class="hbar-fill" style="width:${(x.n / max) * 100}%"></div></div>` +
            `<span class="hbar-count">${x.n}</span></div>`
        )
        .join('')
    : '<p class="muted">Sin entradas registradas hoy.</p>';

  try {
    const recent = await api('/api/attendance/history?limit=12');
    $('#dash-recent').innerHTML = recent.length
      ? recent
          .map(
            (r) =>
              `<li>${fmtDate(r.timestamp)} ${r.timestamp.slice(11, 16)} - <b>${esc(r.user_name)}</b> ` +
              `<span class="chip ${r.type}">${typeLabel(r.type)}</span>${r.note ? ' - ' + esc(r.note) : ''}</li>`
          )
          .join('')
      : '<li class="muted">Sin actividad.</li>';
  } catch (e) {
    /* ignore */
  }
}

async function loadAdminUsers() {
  state.allUsers = await api('/api/users');
  renderUsersTable();
}

function renderUsersTable() {
  $('#users-tbody').innerHTML = state.allUsers.length
    ? state.allUsers
        .map(
          (u) =>
            `<tr>
              <td class="td-avatar">${avatarHTML(u, 38)}</td>
              <td>${esc(u.name)}</td>
              <td>${esc(u.email || '-')}</td>
              <td>${esc(u.phone || '-')}</td>
              <td><span class="chip ${u.role}">${u.role === 'admin' ? 'Administrador' : 'Usuario'}</span></td>
              <td class="td-actions">
                <button class="btn btn-sm" onclick="editUser(${u.id})">Editar</button>
                <button class="btn btn-sm" onclick="delUser(${u.id})">Eliminar</button>
              </td>
            </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="muted">Sin usuarios.</td></tr>';
}

let editingUserId = null;

function newUser() {
  editingUserId = null;
  $('#uf-title').textContent = 'Nuevo usuario';
  $('#uf-id').value = '';
  $('#uf-name').value = '';
  $('#uf-email').value = '';
  $('#uf-phone').value = '';
  $('#uf-pin').value = '';
  $('#uf-pin').placeholder = 'Clave inicial (mín. 4)';
  $('#uf-role').value = 'user';
  $('#uf-photo').value = '';
  openModal('user-form-modal');
}

function editUser(id) {
  const u = state.allUsers.find((x) => x.id === id);
  if (!u) return;
  editingUserId = id;
  $('#uf-title').textContent = 'Editar: ' + u.name;
  $('#uf-id').value = u.id;
  $('#uf-name').value = u.name;
  $('#uf-email').value = u.email || '';
  $('#uf-phone').value = u.phone || '';
  $('#uf-pin').value = '';
  $('#uf-pin').placeholder = 'Dejar vacío para no cambiar';
  $('#uf-role').value = u.role;
  $('#uf-photo').value = '';
  openModal('user-form-modal');
}

async function saveUser() {
  const payload = {
    name: $('#uf-name').value.trim(),
    email: $('#uf-email').value.trim() || null,
    phone: $('#uf-phone').value.trim() || null,
    role: $('#uf-role').value,
    pin: $('#uf-pin').value,
  };
  if (!payload.name) return toast('El nombre es obligatorio', 'err');
  try {
    if (editingUserId) {
      await api('/api/users/' + editingUserId, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      if (!payload.pin) return toast('Ingresa la clave inicial', 'err');
      await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal('user-form-modal');
    toast('Usuario guardado');
    if (!editingUserId) return location.reload();
    await refreshBase();
    renderUsersTable();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function delUser(id) {
  if (!confirm('¿Eliminar este usuario y todo su historial?')) return;
  try {
    await api('/api/users/' + id, { method: 'DELETE' });
    toast('Usuario eliminado');
    await refreshBase();
    renderUsersTable();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function uploadUserPhoto() {
  const id = Number($('#uf-id').value);
  if (!id) return toast('Primero guarda el usuario', 'err');
  const file = $('#uf-photo').files[0];
  if (!file) return toast('Selecciona una foto', 'err');
  const fd = new FormData();
  fd.append('photo', file);
  try {
    await api('/api/users/' + id + '/photo', { method: 'POST', body: fd });
    toast('Foto subida');
    await refreshBase();
    renderUsersTable();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function setHistoryFilter(key, value) {
  state.historyFilters[key] = value;
}

async function fillHistoryUsers() {
  if (!state.allUsers.length) await loadAdminUsers();
  const sel = $('#f-user');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Todos los usuarios</option>' +
    state.allUsers.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  sel.value = state.historyFilters.userId || current || '';
}

function clearHistoryFilters() {
  state.historyFilters = {};
  $('#f-from').value = '';
  $('#f-to').value = '';
  $('#f-user').value = '';
  $('#f-type').value = '';
  loadHistory();
}

async function loadHistory() {
  const f = state.historyFilters;
  const q = new URLSearchParams();
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.userId) q.set('userId', f.userId);
  if (f.type) q.set('type', f.type);
  try {
    const rows = await api('/api/attendance/history?' + q);
    state.historyRows = rows;
    $('#history-tbody').innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<tr>
                <td>${fmtDate(r.timestamp)}</td>
                <td>${r.timestamp.slice(11, 16)}</td>
                <td>${esc(r.user_name)}</td>
                <td><span class="chip ${r.type}">${typeLabel(r.type)}</span></td>
                <td>${esc(r.note || '')}</td>
                <td class="td-actions">
                  <button class="btn btn-sm" onclick="editRecord(${r.id})">Editar</button>
                  <button class="btn btn-sm" onclick="delRecord(${r.id})">Eliminar</button>
                </td>
              </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="muted">Sin registros.</td></tr>';
  } catch (e) {
    toast(e.message, 'err');
  }
}

let editingRecordId = null;

function editRecord(id) {
  const r = state.historyRows.find((x) => x.id === id);
  if (!r) return;
  editingRecordId = id;
  $('#rf-id').value = r.id;
  $('#rf-type').value = r.type;
  $('#rf-note').value = r.note || '';
  $('#rf-datetime').value = r.timestamp.replace(' ', 'T').slice(0, 16);
  openModal('record-form-modal');
}

async function saveRecord() {
  let ts = $('#rf-datetime').value;
  if (ts) ts = ts.replace('T', ' ') + ':00';
  try {
    await api('/api/attendance/history/' + editingRecordId, {
      method: 'PUT',
      body: JSON.stringify({ type: $('#rf-type').value, timestamp: ts, note: $('#rf-note').value }),
    });
    closeModal('record-form-modal');
    toast('Registro actualizado');
    await Promise.all([loadHistory(), loadToday()]);
    renderMarking();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function delRecord(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await api('/api/attendance/history/' + id, { method: 'DELETE' });
    toast('Registro eliminado');
    await Promise.all([loadHistory(), loadToday()]);
    renderMarking();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function exportCSV() {
  const f = state.historyFilters;
  const q = new URLSearchParams();
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.userId) q.set('userId', f.userId);
  try {
    const res = await fetch('/api/attendance/export?' + q, {
      headers: { Authorization: 'Bearer ' + state.token },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al exportar');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'asistencia.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV descargado');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function fillSettings() {
  const s = state.settings;
  $('#set-name').value = s.app_name || '';
  $('#set-theme').value = s.default_theme || 'light';
  $('#set-accent').value = s.accent || '#1e6ef0';
  $('#set-logo-img').src = s.logo || DEFAULT_AVATAR;
  $('#set-logo-img').style.opacity = s.logo ? '1' : '0.3';
  $('#set-bg-img').src = s.background || DEFAULT_AVATAR;
  $('#set-bg-img').style.opacity = s.background ? '1' : '0.3';
}

async function saveSettings() {
  const payload = {
    app_name: $('#set-name').value.trim(),
    default_theme: $('#set-theme').value,
    accent: $('#set-accent').value,
  };
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    Object.assign(state.settings, payload);
    applyBrand();
    if (!localStorage.getItem('ca_theme')) setupTheme();
    toast('Configuración guardada');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function uploadLogo() {
  const file = $('#set-logo-file').files[0];
  if (!file) return toast('Selecciona un archivo', 'err');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await api('/api/settings/logo', { method: 'POST', body: fd });
    state.settings.logo = data.logo;
    applyBrand();
    $('#set-logo-img').src = data.logo;
    $('#set-logo-img').style.opacity = '1';
    toast('Logo actualizado');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function clearLogo() {
  try {
    await api('/api/settings/logo', { method: 'DELETE' });
    state.settings.logo = '';
    applyBrand();
    $('#set-logo-img').src = DEFAULT_AVATAR;
    $('#set-logo-img').style.opacity = '0.3';
    toast('Logo eliminado');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function uploadBackground() {
  const file = $('#set-bg-file').files[0];
  if (!file) return toast('Selecciona un archivo', 'err');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await api('/api/settings/background', { method: 'POST', body: fd });
    state.settings.background = data.background;
    applyBrand();
    $('#set-bg-img').src = data.background;
    $('#set-bg-img').style.opacity = '1';
    toast('Fondo actualizado');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function clearBackground() {
  try {
    await api('/api/settings/background', { method: 'DELETE' });
    state.settings.background = '';
    applyBrand();
    $('#set-bg-img').src = DEFAULT_AVATAR;
    $('#set-bg-img').style.opacity = '0.3';
    toast('Fondo eliminado');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function refreshBase() {
  await Promise.all([loadPublic(), loadToday()]);
  renderMarking();
  updateLoggedUser();
}

let deferredPrompt = null;

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btn-install').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  });
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone) {
    $('#btn-install').hidden = true;
  } else if (isIOS) {
    $('#btn-install').hidden = false;
    $('#install-hint').textContent = 'En iOS: menú Compartir > "Añadir a pantalla de inicio" para instalar la app.';
  }
}

async function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  } else {
    toast('En iOS: abre el menú Compartir y elige "Añadir a pantalla de inicio"');
  }
}

function bindEvents() {
  $('#pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPin();
  });
  $('#rec-contact').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitRecovery();
  });
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('open');
    });
  });
}

const INACTIVITY_TIMEOUT = 5 * 60 * 1000;
let inactivityTimer = null;

function resetInactivity() {
  clearTimeout(inactivityTimer);
  if (state.token) {
    inactivityTimer = setTimeout(() => {
      headerLogout();
      toast('Sesión cerrada por inactividad', 'err');
    }, INACTIVITY_TIMEOUT);
  }
}

function setupInactivity() {
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((evt) => {
    document.addEventListener(evt, resetInactivity, { passive: true });
  });
  resetInactivity();
}

function stopInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = null;
}

let lastGridKey = '';

function gridKey() {
  return JSON.stringify([state.today, state.users]);
}

async function autoRefresh() {
  if (document.querySelector('.modal.open')) return;
  try {
    if (!$('#view-admin').hidden) {
      if (state.adminTab === 'dashboard') await loadDashboard();
      else if (state.adminTab === 'users') await loadAdminUsers();
      else if (state.adminTab === 'history') await loadHistory();
      return;
    }
    await Promise.all([loadPublic(), loadToday()]);
    const key = gridKey();
    if (key !== lastGridKey) {
      lastGridKey = key;
      renderMarking();
    }
  } catch (e) {
    /* silencioso: el próximo ciclo reintenta */
  }
}

const WMO_ICONS = {
  0: '\u2600\uFE0F', 1: '\uD83C\uDF24\uFE0F', 2: '\u26C5', 3: '\u2601\uFE0F',
  45: '\uD83C\uDF2B\uFE0F', 48: '\uD83C\uDF2B\uFE0F',
  51: '\uD83C\uDF26\uFE0F', 53: '\uD83C\uDF26\uFE0F', 55: '\uD83C\uDF27\uFE0F',
  61: '\uD83C\uDF27\uFE0F', 63: '\uD83C\uDF27\uFE0F', 65: '\uD83C\uDF27\uFE0F',
  71: '\u2744\uFE0F', 73: '\u2744\uFE0F', 75: '\u2744\uFE0F',
  77: '\uD83C\uDF28\uFE0F', 80: '\uD83C\uDF26\uFE0F', 81: '\uD83C\uDF27\uFE0F',
  82: '\uD83C\uDF29\uFE0F', 85: '\u2744\uFE0F', 86: '\u2744\uFE0F',
  95: '\u26C8\uFE0F', 96: '\u26C8\uFE0F', 99: '\u26C8\uFE0F',
};

const WMO_DESC = {
  0: 'Cielo despejado', 1: 'Principalmente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha',
  51: 'Lluvia ligera', 53: 'Lluvia moderada', 55: 'Lluvia intensa',
  61: 'Lluvia', 63: 'Lluvia moderada', 65: 'Lluvia fuerte',
  71: 'Nieve ligera', 73: 'Nieve moderada', 75: 'Nieve fuerte',
  77: 'Granizo', 80: 'Chubascos', 81: 'Chubascos moderados', 82: 'Chubascos fuertes',
  85: 'Chubascos de nieve', 86: 'Chubascos fuertes de nieve',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta fuerte con granizo',
};

function startClock() {
  function tick() {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateStr = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#clock-date').textContent = dateStr;
    $('#clock-time').textContent = timeStr;
    $('#clock-tz').textContent = tz;
  }
  tick();
  setInterval(tick, 1000);
}

function loadWeather() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
        );
        const data = await res.json();
        const c = data.current;
        const code = c.weather_code;
        $('#weather-icon').textContent = WMO_ICONS[code] || '';
        $('#weather-text').textContent = `${Math.round(c.temperature_2m)}\u00B0C \u2014 ${WMO_DESC[code] || ''}`;
        $('#clock-weather').hidden = false;
      } catch (_) { /* ignore */ }
    },
    () => { /* geolocation denied */ },
    { timeout: 10000 }
  );
}

(async function init() {
  try {
    await loadSettings();
  } catch (e) {
    toast('No se pudo conectar con el servidor', 'err');
  }
  applyBrand();
  setupTheme();
  startClock();
  loadWeather();
  try {
    await Promise.all([loadPublic(), loadToday()]);
  } catch (e) {
    /* handled arriba */
  }
  renderMarking();
  lastGridKey = gridKey();
  setupInstall();
  bindEvents();
  setInterval(autoRefresh, 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) autoRefresh();
  });
  if (state.token) {
    try {
      state.me = await api('/api/auth/me');
      localStorage.setItem('ca_me', JSON.stringify(state.me));
      $('#btn-logout').hidden = false;
      setupInactivity();
      updateLoggedUser();
    } catch (e) {
      state.token = null;
      state.me = null;
      localStorage.removeItem('ca_token');
      localStorage.removeItem('ca_me');
    }
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
