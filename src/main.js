const { invoke } = window.__TAURI__.core;

let currentServer = null;
let currentServerIdx = null;
let uptimeStart = null;
let uptimeInterval = null;
let overviewInterval = null;
let consoleWatchInterval = null;
let lastLogSize = -1;
let currentPath = '';
let selectedFiles = new Set();
let currentEditorFile = '';

function toast(msg) {
  document.getElementById('toast-msg').textContent = msg;
  const t = document.getElementById('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
window.hideToast = () => document.getElementById('toast').classList.remove('show');

document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 's') {
    const editorTab = document.getElementById('tab-editor');
    if (editorTab && editorTab.classList.contains('active')) {
      e.preventDefault();
      saveFile();
    }
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (document.getElementById('modal-folder').classList.contains('show')) { e.preventDefault(); confirmNewFolder(); }
  else if (document.getElementById('modal-file').classList.contains('show')) { e.preventDefault(); confirmNewFile(); }
  else if (document.getElementById('modal-create').classList.contains('show')) { e.preventDefault(); createServer(); }
  else if (document.getElementById('modal-confirm').classList.contains('show')) { e.preventDefault(); confirmOk(); }
});

window.setTheme = function(t) {
  document.body.classList.toggle('light', t === 'light');
  document.getElementById('theme-dark').classList.toggle('active', t === 'dark');
  document.getElementById('theme-light').classList.toggle('active', t === 'light');
  localStorage.setItem('ami-theme', t);
};
setTheme(localStorage.getItem('ami-theme') || 'dark');

window.navTo = function(page, el) {
  if (page === 'create') { showModal('modal-create'); return; }
  clearAllIntervals();
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('main-view').style.display = 'flex';
  document.getElementById('manage-view').style.display = 'none';
  document.getElementById('page-servers').style.display = page === 'servers' ? 'flex' : 'none';
  document.getElementById('page-settings').style.display = page === 'settings' ? 'flex' : 'none';
  document.getElementById('page-title').textContent = page === 'servers' ? 'Mes serveurs' : 'Paramètres';
};

async function loadServers() {
  const names = await invoke('get_servers');
  const readyChecks = await Promise.all(names.map(n => invoke('is_server_ready', { name: n })));
  window._servers = names.map((n, i) => ({ name: n, state: 'off', ready: readyChecks[i] }));
  renderServers();
}

function syncState(name, state) {
  const idx = window._servers.findIndex(s => s.name === name);
  if (idx !== -1) window._servers[idx].state = state;
  if (currentServer && currentServer.name === name) currentServer.state = state;
}

function updateStats() {
  const on = window._servers.filter(s => s.state === 'on').length;
  document.getElementById('stat-total').textContent = window._servers.length;
  document.getElementById('stat-on').textContent = on;
  document.getElementById('stat-off').textContent = window._servers.length - on;
}

function renderServers() {
  const list = document.getElementById('server-list');
  list.innerHTML = '';
  window._servers.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'server-card' + (s.state === 'on' ? ' online' : '');
    const badgeClass = s.state === 'on' ? 'badge-on' : s.state === 'starting' ? 'badge-starting' : 'badge-off';
    const badgeText = s.state === 'on' ? 'En ligne' : s.state === 'starting' ? 'Démarrage...' : s.state === 'installing' ? 'Installation...' : s.ready ? 'Arrêté' : 'Non installé';
    const dotClass = s.state === 'on' ? 'dot-on' : s.state === 'starting' ? 'dot-starting' : 'dot-off';
    let btns = '';
    if (s.ready) {
      if (s.state === 'off') btns += `<button class="btn-sm" onclick="startServer(${i})">Démarrer</button>`;
      if (s.state === 'on') btns += `<button class="btn-sm" onclick="stopServer(${i})">Arrêter</button>`;
      btns += `<button class="btn-sm" onclick="openManage(${i})">Gérer</button>`;
    }
    card.innerHTML = `
      <div class="dot ${dotClass}"></div>
      <div class="server-info">
        <div class="server-name">${s.name}</div>
        <div class="server-meta">PocketMine · ${s.ready ? (s.state === 'on' ? 'En ligne' : 'Prêt') : 'Installation requise'}</div>
      </div>
      <span class="badge ${badgeClass}">${badgeText}</span>
      <div class="card-actions">${btns}</div>`;
    list.appendChild(card);
  });
  updateStats();
}

window.showModal = id => document.getElementById(id).classList.add('show');
window.hideModal = id => document.getElementById(id).classList.remove('show');

window.createServer = async function() {
  const name = document.getElementById('new-name').value.trim();
  if (!name) return;
  const btn = document.getElementById('btn-modal-create');
  btn.textContent = 'Création...'; btn.disabled = true;
  try {
    await invoke('create_server', { name });
    document.getElementById('new-name').value = '';
    await loadServers();
    hideModal('modal-create');
    const idx = window._servers.findIndex(s => s.name === name);
    if (idx !== -1) installServer(idx);
  } catch(e) { toast('Erreur : ' + e); }
  finally { btn.textContent = 'Créer'; btn.disabled = false; }
};

async function installServer(i) {
  window._servers[i].state = 'installing'; renderServers();
  try {
    await invoke('setup_server', { name: window._servers[i].name });
    window._servers[i].state = 'off'; window._servers[i].ready = true;
    toast('Serveur installé !');
  } catch(e) { toast('Erreur installation : ' + e); window._servers[i].state = 'off'; }
  renderServers();
}

window.startServer = async function(i) {
  window._servers[i].state = 'starting'; renderServers();
  try {
    await invoke('start_server', { name: window._servers[i].name });
    syncState(window._servers[i].name, 'on');
  } catch(e) { toast('Erreur : ' + e); syncState(window._servers[i].name, 'off'); }
  renderServers();
};

window.stopServer = async function(i) {
  try {
    await invoke('stop_server', { name: window._servers[i].name });
    syncState(window._servers[i].name, 'off');
  } catch(e) { toast('Erreur : ' + e); }
  renderServers();
};

window.openManage = function(i) {
  currentServerIdx = i;
  currentServer = window._servers[i];
  currentPath = '';
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('manage-view').style.display = 'flex';
  document.getElementById('manage-server-name').textContent = currentServer.name;
  updateActionBtns();
  switchTab('overview');
};

function clearAllIntervals() {
  [uptimeInterval, overviewInterval, consoleWatchInterval].forEach(id => { if (id) clearInterval(id); });
  uptimeInterval = overviewInterval = consoleWatchInterval = null;
}

function updateActionBtns() {
  document.getElementById('btn-start').disabled = currentServer.state === 'on' || currentServer.state === 'starting';
  document.getElementById('btn-stop').disabled = currentServer.state !== 'on';
  document.getElementById('btn-restart').disabled = currentServer.state !== 'on';
}

window.switchTab = function(tab) {
  document.querySelectorAll('.topbar-tab').forEach(t => t.classList.remove('active'));
  const el = document.querySelector(`.topbar-tab[data-tab="${tab}"]`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  clearAllIntervals();
  if (tab === 'overview') startOverview();
  if (tab === 'console') startConsoleWatch();
  if (tab === 'files') loadFiles('');
  if (tab === 'info') loadInfo();
  if (tab === 'version') loadVersion();
};

function startOverview() {
  updateOvDisplay();
  overviewInterval = setInterval(async () => {
    const running = await invoke('is_server_running', { name: currentServer.name });
    if (!running && currentServer.state === 'on') {
      syncState(currentServer.name, 'off');
      uptimeStart = null;
      if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
    }
    updateOvDisplay();
  }, 2000);
  if (currentServer.state === 'on') {
    if (!uptimeStart) uptimeStart = Date.now();
    uptimeInterval = setInterval(tickUptime, 1000);
  }
}

function tickUptime() {
  if (!uptimeStart) { document.getElementById('ov-uptime').textContent = '—'; return; }
  const s = Math.floor((Date.now() - uptimeStart) / 1000);
  document.getElementById('ov-uptime').textContent =
    `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function updateOvDisplay() {
  const s = currentServer;
  const el = document.getElementById('ov-status');
  el.textContent = s.state === 'on' ? 'En ligne' : s.state === 'starting' ? 'Démarrage...' : 'Arrêté';
  el.style.color = s.state === 'on' ? '#4a9a4a' : s.state === 'starting' ? '#BA7517' : 'var(--text2)';
  document.getElementById('ov-players').textContent = s.state === 'on' ? '0' : '—';
  if (s.state !== 'on') document.getElementById('ov-uptime').textContent = '—';
  updateActionBtns();
}

window.manageStart = async function() {
  syncState(currentServer.name, 'starting');
  uptimeStart = null; updateActionBtns();
  try {
    await invoke('start_server', { name: currentServer.name });
    syncState(currentServer.name, 'on');
    uptimeStart = Date.now();
    if (!uptimeInterval) uptimeInterval = setInterval(tickUptime, 1000);
    toast('Serveur démarré');
  } catch(e) {
    toast('Erreur : ' + e);
    syncState(currentServer.name, 'off');
  }
  updateOvDisplay();
  renderServers();
};

window.manageStop = async function() {
  try {
    await invoke('stop_server', { name: currentServer.name });
    syncState(currentServer.name, 'off');
    uptimeStart = null;
    if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
    toast('Serveur arrêté');
  } catch(e) { toast('Erreur : ' + e); }
  updateOvDisplay();
  renderServers();
};

window.manageRestart = async function() {
  await manageStop();
  await new Promise(r => setTimeout(r, 1500));
  await manageStart();
};

function cleanLog(raw) {
  return raw
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[^m]*m/g, '')
    .replace(/\x1b\(B/g, '')
    .replace(/\r/g, '')
    .replace(/^Script started[^\n]*\n/, '')
    .replace(/\nScript done[^\n]*$/, '');
}

function renderLog(text) {
  const el = document.getElementById('console-output');
  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
  el.textContent = cleanLog(text || '') || '';
  if (atBottom) el.scrollTop = el.scrollHeight;
}

window.clearConsole = async function() {
  try {
    await invoke('clear_server_logs', { name: currentServer.name });
    document.getElementById('console-output').textContent = '';
    lastLogSize = 0;
    toast('Console clear');
  } catch(e) { toast('Erreur : ' + e); }
};

function startConsoleWatch() {
  lastLogSize = -1;
  pollConsole();
  consoleWatchInterval = setInterval(pollConsole, 500);
}

async function pollConsole() {
  try {
    const size = await invoke('get_log_size', { name: currentServer.name });
    if (size !== lastLogSize) {
      lastLogSize = size;
      const logs = await invoke('get_server_logs', { name: currentServer.name });
      renderLog(logs);
    }
  } catch(e) {}
}

window.sendCmd = async function() {
  const inp = document.getElementById('cmd-input');
  const cmd = inp.value.trim();
  if (!cmd) return;
  inp.value = '';
  try {
    await invoke('send_server_command', { name: currentServer.name, command: cmd });
  } catch(e) { toast('Erreur commande : ' + e); }
};

async function loadFiles(subpath) {
  currentPath = subpath;
  selectedFiles = new Set();
  document.getElementById('btn-delete').disabled = true;

  const parts = subpath ? subpath.split('/').filter(Boolean) : [];
  let bc = '';
  let built = '';
  parts.forEach((p, i) => {
    built += (i > 0 ? '/' : '') + p;
    const b = built;
    bc += `<span class="bc-sep">/</span><span class="bc-item" data-path="${b}">${p}</span>`;
  });
  document.getElementById('breadcrumb').innerHTML = bc;
  document.querySelectorAll('.bc-item').forEach(el => {
    el.addEventListener('click', () => loadFiles(el.dataset.path));
  });

  const list = document.getElementById('files-list');
  try {
    const files = await invoke('list_dir_files', { name: currentServer.name, subpath });
    if (!files.length) {
      list.innerHTML = '<div style="color:var(--text3);padding:8px;font-size:13px">Dossier vide</div>';
      return;
    }
    list.innerHTML = '';
    files.forEach(f => {
      const fullPath = (subpath ? subpath + '/' : '') + f.name;
      const ext = f.name.split('.').pop().toLowerCase();
      const editable = ['yml','yaml','json','properties','txt','ini','cfg','conf','log','php','js','css','html','xml','md','sh'].includes(ext);

      const row = document.createElement('div');
      row.className = 'file-item';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'chk';
      chk.addEventListener('change', () => toggleSelect(fullPath, chk.checked));

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = f.is_dir ? '📁' : '📄';

      const name = document.createElement('span');
      name.className = 'file-name' + (f.is_dir ? ' is-dir' : '');
      name.textContent = f.name;

      if (f.is_dir) {
        name.addEventListener('click', () => loadFiles(fullPath));
      } else if (editable) {
        name.style.cursor = 'pointer';
        name.addEventListener('click', () => openEditor(fullPath, f.name));
      }

      row.appendChild(chk);
      row.appendChild(icon);
      row.appendChild(name);
      list.appendChild(row);
    });
  } catch(e) {
    list.innerHTML = '<div style="color:var(--text3);padding:8px">Erreur lecture</div>';
  }
}

function toggleSelect(path, checked) {
  if (checked) selectedFiles.add(path);
  else selectedFiles.delete(path);
  document.getElementById('btn-delete').disabled = selectedFiles.size === 0;
}

window.deleteSelected = async function() {
  if (!selectedFiles.size) return;
  const names = [...selectedFiles].map(p => p.split('/').pop()).join(', ');
  showConfirmModal(`Supprimer : ${names} ?`, async () => {
    try {
      await invoke('delete_server_files', { name: currentServer.name, paths: [...selectedFiles] });
      toast('Supprimé');
      loadFiles(currentPath);
    } catch(e) { toast('Erreur : ' + e); }
  });
};

window.showNewFolderModal = () => { document.getElementById('folder-name').value = ''; showModal('modal-folder'); };
window.showNewFileModal = () => { document.getElementById('file-name').value = ''; showModal('modal-file'); };

window.confirmNewFolder = async function() {
  const name = document.getElementById('folder-name').value.trim();
  if (!name) return;
  try {
    await invoke('create_server_folder', { name: currentServer.name, subpath: currentPath, folderName: name });
    hideModal('modal-folder');
    toast('Dossier créé');
    loadFiles(currentPath);
  } catch(e) { toast('Erreur : ' + e); }
};

window.confirmNewFile = async function() {
  const name = document.getElementById('file-name').value.trim();
  if (!name) return;
  try {
    await invoke('create_server_file', { name: currentServer.name, subpath: currentPath, fileName: name });
    hideModal('modal-file');
    toast('Fichier créé');
    loadFiles(currentPath);
  } catch(e) { toast('Erreur : ' + e); }
};

function showConfirmModal(msg, cb) {
  confirmCallback = cb;
  document.getElementById('confirm-msg').textContent = msg;
  showModal('modal-confirm');
}
window.confirmOk = async function() {
  hideModal('modal-confirm');
  if (confirmCallback) await confirmCallback();
  confirmCallback = null;
};
window.confirmCancel = function() {
  hideModal('modal-confirm');
  confirmCallback = null;
};

window.openEditor = async function(filePath, fileName) {
  try {
    const content = await invoke('read_server_file', { name: currentServer.name, subpath: filePath });
    currentEditorFile = filePath;
    document.getElementById('editor-filename').textContent = fileName;
    document.getElementById('file-editor').value = content;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-editor').style.display = 'flex';
    document.getElementById('tab-editor').classList.add('active');
    document.getElementById('file-editor').focus();
  } catch(e) { toast('Impossible d\'ouvrir : ' + e); }
};

window.saveFile = async function() {
  const content = document.getElementById('file-editor').value;
  try {
    await invoke('write_server_file', { name: currentServer.name, subpath: currentEditorFile, content });
    toast('Sauvegardé');
  } catch(e) { toast('Erreur sauvegarde : ' + e); }
};

window.closeEditor = function() {
  document.getElementById('tab-editor').style.display = 'none';
  switchTab('files');
};

async function loadInfo() {
  try {
    const info = await invoke('get_server_info', { name: currentServer.name });
    const version = await invoke('get_server_version', { name: currentServer.name });
    document.getElementById('info-status').textContent = currentServer.state === 'on' ? 'En ligne' : 'Arrêté';
    document.getElementById('info-ram').textContent = info.ram || 'N/A';
    document.getElementById('info-version').textContent = version || 'N/A';
  } catch(e) {}
}

async function loadVersion() {
  try {
    const versions = await invoke('get_available_versions');
    const sel = document.getElementById('version-select');
    sel.innerHTML = '<option value="">— Sélectionner —</option>' + versions.map(v => `<option value="${v}">${v}</option>`).join('');
    const cur = await invoke('get_server_version', { name: currentServer.name });
    document.getElementById('current-version').textContent = cur || 'Inconnue';
  } catch(e) {}
}

window.updateVersion = async function() {
  const version = document.getElementById('version-select').value;
  if (!version) { toast('Veuillez sélectionnez une version '); return; }
  const btn = document.getElementById('btn-update');
  btn.textContent = 'Mise à jour...'; btn.disabled = true;
  try {
    await invoke('update_server_version', { name: currentServer.name, version });
    toast('Mis à jour vers ' + version);
    loadVersion();
  } catch(e) { toast('Erreur : ' + e); }
  finally { btn.textContent = 'Mettre à jour'; btn.disabled = false; }
};

window._servers = [];
loadServers();
