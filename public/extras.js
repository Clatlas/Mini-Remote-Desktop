(() => {
  const $ = id => document.getElementById(id);
  addGpuMetric();
  addDiagnostics();
  updateBrowserCopy();

  function addGpuMetric() {
    const grid = document.querySelector('.metrics-grid');
    if (!grid || $('gpuMetric')) return;
    const metric = document.createElement('div');
    metric.className = 'metric';
    metric.innerHTML = '<span>GPU</span><strong id="gpuMetric">—</strong><small id="gpuName" class="dashboard-gpu-name"></small>';
    const uptime = $('uptimeMetric')?.closest('.metric');
    if (uptime) grid.insertBefore(metric, uptime);
    else grid.appendChild(metric);
    grid.classList.add('metrics-grid-four');

    const style = document.createElement('style');
    style.textContent = `
      .metrics-grid.metrics-grid-four{grid-template-columns:1fr 1fr}.metrics-grid-four .metric{min-height:57px}.dashboard-gpu-name{display:block;margin-top:2px;color:var(--muted-2);font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .diagnostic-row .admin-row-icon{color:var(--accent-strong)}
      .diagnostics-dialog{width:min(calc(100% - 20px),420px);max-width:420px;max-height:82dvh;border:1px solid var(--border);border-radius:22px;padding:0;background:var(--surface);color:var(--text)}.diagnostics-dialog::backdrop{background:rgba(0,0,0,.72)}.diagnostics-card{padding:16px}.diagnostics-card header{display:flex;align-items:center;justify-content:space-between;gap:12px}.diagnostics-card h2{margin:0;font-size:17px}.diagnostics-card header button{width:42px;height:42px;border:0;border-radius:13px;background:var(--surface-2);color:var(--text);font-size:20px}.diagnostics-card pre{margin:14px 0 0;max-height:60dvh;overflow:auto;-webkit-overflow-scrolling:touch;white-space:pre-wrap;word-break:break-word;background:#06080b;border:1px solid var(--border);border-radius:15px;padding:12px;color:#c9d2df;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    `;
    document.head.appendChild(style);

    refreshGpu();
    const es = new EventSource('/api/events');
    es.addEventListener('status', event => {
      try { renderGpu(JSON.parse(event.data)); } catch {}
    });
  }

  async function refreshGpu() {
    try {
      const response = await fetch('/api/status', { cache:'no-store' });
      if (response.ok) renderGpu(await response.json());
    } catch {}
  }

  function renderGpu(status) {
    const percent = status?.metrics?.gpuPercent;
    const name = status?.metrics?.gpuName;
    if ($('gpuMetric')) $('gpuMetric').textContent = Number.isFinite(percent) ? `${percent}%` : '—';
    if ($('gpuName')) {
      $('gpuName').textContent = name || '';
      $('gpuName').title = name || '';
    }
  }

  function addDiagnostics() {
    const groups = document.querySelectorAll('#adminMenu .admin-group');
    const host = groups[groups.length - 1];
    if (!host || $('[data-diagnostic="mrd"]')) return;

    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.innerHTML = '<h3>Diagnostics</h3><span>Logs & connection health</span>';
    host.parentNode.appendChild(title);

    const group = document.createElement('div');
    group.className = 'admin-group';
    group.innerHTML = `
      <button class="admin-row diagnostic-row" data-diagnostic="mrd"><span class="admin-row-icon">≋</span><span><strong>MRD Logs</strong><small>Recent host runtime output</small></span><span>›</span></button>
      <button class="admin-row diagnostic-row" data-diagnostic="guacamole"><span class="admin-row-icon">G</span><span><strong>Guacamole Logs</strong><small>Gateway and guacd output</small></span><span>›</span></button>
      <button class="admin-row diagnostic-row" data-diagnostic="rdp"><span class="admin-row-icon">R</span><span><strong>RDP Status</strong><small>Service, listener, and session health</small></span><span>›</span></button>`;
    title.after(group);

    const dialog = document.createElement('dialog');
    dialog.id = 'diagnosticsDialog';
    dialog.className = 'diagnostics-dialog';
    dialog.innerHTML = '<div class="diagnostics-card"><header><h2 id="diagnosticsTitle">Diagnostics</h2><button id="diagnosticsClose">×</button></header><pre id="diagnosticsText">Loading…</pre></div>';
    document.body.appendChild(dialog);
    $('diagnosticsClose')?.addEventListener('click', () => dialog.close());
    group.querySelectorAll('[data-diagnostic]').forEach(button => button.addEventListener('click', () => openDiagnostic(button.dataset.diagnostic)));
  }

  async function openDiagnostic(kind) {
    const dialog = $('diagnosticsDialog');
    $('diagnosticsTitle').textContent = kind === 'mrd' ? 'MRD Logs' : kind === 'guacamole' ? 'Guacamole Logs' : 'RDP Status';
    $('diagnosticsText').textContent = 'Loading…';
    dialog.showModal();
    try {
      const response = await fetch(`/api/admin/diagnostics?kind=${encodeURIComponent(kind)}`, { cache:'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load diagnostics.');
      $('diagnosticsTitle').textContent = body.title || 'Diagnostics';
      $('diagnosticsText').textContent = body.text || 'No output.';
    } catch (error) {
      $('diagnosticsText').textContent = error.message;
    }
  }

  function updateBrowserCopy() {
    const dashboard = $('browserBtn');
    if (dashboard) {
      const small = dashboard.querySelector('small');
      if (small) small.textContent = 'PC-powered mobile Chromium';
    }
    const command = $('commandBrowser');
    if (command) {
      const small = command.querySelector('small');
      if (small) small.textContent = 'Mobile Browser Engine';
    }
  }
})();
