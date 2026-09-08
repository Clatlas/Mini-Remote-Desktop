(() => {
  const $ = id => document.getElementById(id);
  const appsMenu = $('appsMenu');
  const appsList = $('appsList');
  if (!appsMenu || !appsList) return;

  let apps = [];
  let discovered = [];

  installManageButton();
  installDialog();
  bind();

  function installManageButton() {
    const panel = appsMenu.querySelector('.panel-scroll');
    const audio = $('appsAudioBtn');
    if (!panel || $('manageAppsBtn')) return;
    const button = document.createElement('button');
    button.id = 'manageAppsBtn';
    button.className = 'apps-manage-button';
    button.innerHTML = '<span>＋</span><span><strong>Manage Apps</strong><small>Add, reorder, or remove launchers</small></span><span>›</span>';
    if (audio?.nextSibling) panel.insertBefore(button, audio.nextSibling);
    else panel.appendChild(button);
  }

  function installDialog() {
    if ($('appsManagerDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'appsManagerDialog';
    dialog.className = 'apps-manager-dialog';
    dialog.innerHTML = `
      <div class="apps-manager-card">
        <header><div><div class="eyebrow">APP LAUNCHER</div><h2>Manage Apps</h2></div><button id="appsManagerClose">×</button></header>
        <div class="apps-manager-tabs"><button class="selected" data-app-manager-tab="pinned">Pinned</button><button data-app-manager-tab="add">Add App</button></div>
        <section id="appsManagerPinned"><div class="panel-loading">Loading apps…</div></section>
        <section id="appsManagerAdd" hidden>
          <label class="apps-discovery-search"><span>⌕</span><input id="appsDiscoverySearch" type="search" placeholder="Search installed apps" /></label>
          <div id="appsDiscoveryList"><div class="panel-loading">Open Add App to scan Windows Start Apps.</div></div>
        </section>
        <button id="appsRestoreDefaults" class="apps-restore-defaults">Restore default MRD apps</button>
      </div>`;
    document.body.appendChild(dialog);

    const style = document.createElement('style');
    style.textContent = `
      .apps-manage-button{width:100%;min-height:62px;margin:10px 0 16px;border:1px dashed rgba(103,162,255,.3);background:rgba(103,162,255,.07);border-radius:17px;display:grid;grid-template-columns:38px 1fr 20px;align-items:center;gap:9px;text-align:left;padding:10px 12px}.apps-manage-button>span:first-child{width:38px;height:38px;border-radius:12px;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent-strong);font-size:20px}.apps-manage-button strong,.apps-manage-button small{display:block}.apps-manage-button strong{font-size:12px}.apps-manage-button small{font-size:9px;color:var(--muted);margin-top:2px}
      .apps-manager-dialog{width:min(100%,440px);height:100dvh;max-width:none;max-height:none;margin:0 auto;border:0;padding:0;background:transparent;color:var(--text)}.apps-manager-dialog::backdrop{background:rgba(0,0,0,.7)}.apps-manager-card{height:100%;background:var(--bg);padding:calc(env(safe-area-inset-top) + 14px) 14px calc(env(safe-area-inset-bottom) + 18px);overflow:auto}.apps-manager-card>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.apps-manager-card h2{margin:3px 0 0;font-size:24px}.apps-manager-card>header button{width:48px;height:48px;border:1px solid var(--border);border-radius:16px;background:var(--surface);font-size:22px}.apps-manager-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--border);background:#080b10;border-radius:15px;margin-bottom:14px}.apps-manager-tabs button{height:46px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-weight:700}.apps-manager-tabs button.selected{background:var(--surface-3);color:var(--text)}
      .apps-manager-row{display:grid;grid-template-columns:1fr 42px 42px 42px;gap:6px;align-items:center;margin:7px 0;padding:9px 9px 9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:16px}.apps-manager-row>span{min-width:0}.apps-manager-row strong,.apps-manager-row small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.apps-manager-row strong{font-size:12px}.apps-manager-row small{font-size:9px;color:var(--muted);margin-top:2px}.apps-manager-row button{height:40px;border:0;border-radius:12px;background:var(--surface-2);font-size:16px}.apps-manager-row button.remove{color:var(--danger)}
      .apps-discovery-search{height:48px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid var(--border);background:var(--surface);border-radius:15px;margin-bottom:12px}.apps-discovery-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text)}.apps-discovery-row{width:100%;min-height:56px;margin:6px 0;border:1px solid var(--border);background:var(--surface);border-radius:15px;padding:9px 12px;display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center;text-align:left}.apps-discovery-row strong,.apps-discovery-row small{display:block}.apps-discovery-row strong{font-size:12px}.apps-discovery-row small{font-size:9px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.apps-discovery-row span:last-child{text-align:center;color:var(--accent-strong);font-size:11px;font-weight:700}.apps-restore-defaults{width:100%;height:48px;margin-top:18px;border:1px solid var(--border);border-radius:15px;background:transparent;color:var(--muted);font-size:11px}
    `;
    document.head.appendChild(style);
  }

  function bind() {
    $('commandApps')?.addEventListener('click', () => setTimeout(refreshApps, 20));
    $('manageAppsBtn')?.addEventListener('click', openManager);
    $('appsManagerClose')?.addEventListener('click', () => $('appsManagerDialog')?.close());
    document.querySelectorAll('[data-app-manager-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.appManagerTab)));
    $('appsDiscoverySearch')?.addEventListener('input', renderDiscovery);
    $('appsRestoreDefaults')?.addEventListener('click', restoreDefaults);
  }

  async function refreshApps() {
    try {
      const result = await fetchJson('/api/apps');
      apps = result.apps || [];
      renderAppGrid();
      renderPinned();
    } catch (error) {
      appsList.innerHTML = `<div class="panel-loading">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderAppGrid() {
    const categories = new Map();
    for (const item of apps) {
      if (!categories.has(item.category)) categories.set(item.category, []);
      categories.get(item.category).push(item);
    }
    appsList.innerHTML = '';
    for (const [category, items] of categories) {
      const section = document.createElement('section');
      section.className = 'app-category';
      const heading = document.createElement('h3');
      heading.textContent = category;
      const grid = document.createElement('div');
      grid.className = 'app-category-grid';
      for (const item of items) {
        const button = document.createElement('button');
        button.className = 'app-card';
        button.dataset.appId = item.id;
        button.disabled = item.available === false;
        button.innerHTML = `<span class="app-card-icon">${escapeHtml(item.icon || '□')}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || '')}</small>`;
        button.addEventListener('click', event => {
          if (document.body.classList.contains('mrd-secret-active')) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          if (item.id === 'mrd-admin') return showAdmin();
          void launchRdpApp(item);
        }, true);
        grid.appendChild(button);
      }
      section.append(heading, grid);
      appsList.appendChild(section);
    }
  }

  async function launchRdpApp(item) {
    toast(`Opening ${item.name}…`);
    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(item.id)}/launch`, { method:'POST' });
      if (result.panel === 'mrd-admin') return showAdmin();
      $('appsMenu').hidden = true;
      $('sessionMenu').hidden = true;
      $('adminMenu').hidden = true;
      $('surfaceTitle').textContent = item.name;
      $('surfaceSubtitle').textContent = 'MRD Desktop';
      $('surfaceToolbar').hidden = false;
      $('surfaceDock').hidden = false;
    } catch (error) { toast(error.message); }
  }

  function showAdmin() {
    $('appsMenu').hidden = true;
    $('sessionMenu').hidden = true;
    $('surfaceToolbar').hidden = true;
    $('surfaceDock').hidden = true;
    $('adminMenu').hidden = false;
  }

  async function openManager() {
    await refreshApps();
    $('appsManagerDialog').showModal();
    switchTab('pinned');
  }

  async function switchTab(tab) {
    document.querySelectorAll('[data-app-manager-tab]').forEach(button => button.classList.toggle('selected', button.dataset.appManagerTab === tab));
    $('appsManagerPinned').hidden = tab !== 'pinned';
    $('appsManagerAdd').hidden = tab !== 'add';
    if (tab === 'add') await loadDiscovery();
  }

  function renderPinned() {
    const host = $('appsManagerPinned');
    if (!host) return;
    host.innerHTML = '';
    apps.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'apps-manager-row';
      row.innerHTML = `<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || 'Other')}</small></span><button class="up" ${index === 0 ? 'disabled' : ''}>↑</button><button class="down" ${index === apps.length - 1 ? 'disabled' : ''}>↓</button><button class="remove">×</button>`;
      row.querySelector('.up').addEventListener('click', () => move(index, -1));
      row.querySelector('.down').addEventListener('click', () => move(index, 1));
      row.querySelector('.remove').addEventListener('click', () => remove(item));
      host.appendChild(row);
    });
  }

  async function move(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= apps.length) return;
    [apps[index], apps[next]] = [apps[next], apps[index]];
    renderPinned();
    try {
      const result = await fetchJson('/api/apps/order', { method:'PUT', body:JSON.stringify({ ids:apps.map(item => item.id) }) });
      apps = result.apps || apps;
      renderAppGrid();
    } catch (error) { toast(error.message); await refreshApps(); }
  }

  async function remove(item) {
    if (!confirm(`Remove ${item.name} from MRD Apps?`)) return;
    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(item.id)}`, { method:'DELETE' });
      apps = result.apps || [];
      renderPinned();
      renderAppGrid();
    } catch (error) { toast(error.message); }
  }

  async function loadDiscovery() {
    const host = $('appsDiscoveryList');
    host.innerHTML = '<div class="panel-loading">Scanning installed Windows apps…</div>';
    try {
      const result = await fetchJson('/api/apps/discover');
      discovered = result.apps || [];
      renderDiscovery();
    } catch (error) { host.innerHTML = `<div class="panel-loading">${escapeHtml(error.message)}</div>`; }
  }

  function renderDiscovery() {
    const host = $('appsDiscoveryList');
    if (!host) return;
    const query = ($('appsDiscoverySearch')?.value || '').trim().toLowerCase();
    const shown = discovered.filter(item => !query || item.name.toLowerCase().includes(query)).slice(0, 100);
    host.innerHTML = '';
    for (const item of shown) {
      const button = document.createElement('button');
      button.className = 'apps-discovery-row';
      button.innerHTML = `<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.appId)}</small></span><span>＋ Add</span>`;
      button.addEventListener('click', () => pin(item));
      host.appendChild(button);
    }
    if (!shown.length) host.innerHTML = '<div class="panel-loading">No matching installed apps.</div>';
  }

  async function pin(item) {
    try {
      const result = await fetchJson('/api/apps/pin', { method:'POST', body:JSON.stringify({ appId:item.appId, name:item.name, category:'Other' }) });
      apps = result.apps || [];
      discovered = discovered.filter(candidate => candidate.appId !== item.appId);
      renderPinned();
      renderDiscovery();
      renderAppGrid();
      toast(`${item.name} added`);
    } catch (error) { toast(error.message); }
  }

  async function restoreDefaults() {
    try {
      const result = await fetchJson('/api/apps/restore-defaults', { method:'POST' });
      apps = result.apps || [];
      renderPinned();
      renderAppGrid();
      toast('Default MRD apps restored');
    } catch (error) { toast(error.message); }
  }

  async function fetchJson(url, options={}) {
    const response = await fetch(url, { cache:'no-store', ...options, headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
    return body;
  }

  function toast(text) {
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3000);
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
})();
