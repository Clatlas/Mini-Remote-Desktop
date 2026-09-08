(() => {
  const $ = id => document.getElementById(id);
  addGpuMetric();
  addDiagnostics();
  addPowerShell();
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
      .diagnostic-row .admin-row-icon,.powershell-row .admin-row-icon{color:var(--accent-strong)}
      .diagnostics-dialog{width:min(calc(100% - 20px),420px);max-width:420px;max-height:82dvh;border:1px solid var(--border);border-radius:22px;padding:0;background:var(--surface);color:var(--text)}.diagnostics-dialog::backdrop{background:rgba(0,0,0,.72)}.diagnostics-card{padding:16px}.diagnostics-card header{display:flex;align-items:center;justify-content:space-between;gap:12px}.diagnostics-card h2{margin:0;font-size:17px}.diagnostics-card header button{width:42px;height:42px;border:0;border-radius:13px;background:var(--surface-2);color:var(--text);font-size:20px}.diagnostics-card pre{margin:14px 0 0;max-height:60dvh;overflow:auto;-webkit-overflow-scrolling:touch;white-space:pre-wrap;word-break:break-word;background:#06080b;border:1px solid var(--border);border-radius:15px;padding:12px;color:#c9d2df;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .powershell-dashboard-section .primary-launch-grid{grid-template-columns:1fr}.powershell-dashboard-section .launch-icon{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .powershell-dialog{width:min(calc(100% - 16px),520px);max-width:520px;height:min(88dvh,780px);max-height:88dvh;border:1px solid var(--border);border-radius:22px;padding:0;background:var(--surface);color:var(--text)}.powershell-dialog::backdrop{background:rgba(0,0,0,.78)}.powershell-card{height:100%;display:flex;flex-direction:column;padding:14px;box-sizing:border-box;gap:10px}.powershell-card header{display:flex;align-items:center;justify-content:space-between;gap:12px}.powershell-card h2{margin:0;font-size:17px}.powershell-card header button{width:42px;height:42px;border:0;border-radius:13px;background:var(--surface-2);color:var(--text);font-size:20px}.powershell-copy{margin:-5px 0 0;color:var(--muted);font-size:11px;line-height:1.45}.powershell-quick{display:flex;gap:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:1px 0 4px;scrollbar-width:none}.powershell-quick::-webkit-scrollbar{display:none}.powershell-quick button{flex:0 0 auto;min-height:36px;border:1px solid var(--border);border-radius:11px;background:var(--surface-2);color:var(--text);padding:0 11px;font-size:11px;font-weight:700;white-space:nowrap}.powershell-quick button:active{transform:scale(.98)}.powershell-input{width:100%;min-height:150px;flex:0 0 31%;resize:none;box-sizing:border-box;border:1px solid var(--border);border-radius:15px;background:#06080b;color:#eef4ff;padding:12px;font:16px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;outline:none;-webkit-appearance:none}.powershell-input:focus{border-color:var(--accent-strong)}.powershell-actions{display:grid;grid-template-columns:1fr 1fr 1.35fr;gap:8px}.powershell-actions button{min-height:44px;border:1px solid var(--border);border-radius:13px;background:var(--surface-2);color:var(--text);font-weight:700}.powershell-actions .powershell-run{background:var(--accent);color:#fff;border-color:transparent}.powershell-actions button:disabled{opacity:.55}.powershell-output-wrap{min-height:0;flex:1;display:flex;flex-direction:column;gap:7px}.powershell-status{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:10px}.powershell-output{margin:0;min-height:0;flex:1;overflow:auto;-webkit-overflow-scrolling:touch;white-space:pre-wrap;word-break:break-word;background:#06080b;border:1px solid var(--border);border-radius:15px;padding:12px;color:#c9d2df;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.powershell-output[data-error="true"]{color:#ffb6b6}
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

  function addPowerShell() {
    if ($('powershellDialog')) return;

    const connectSection = $('browserBtn')?.closest('.section-block');
    if (connectSection && !$('powershellDashboardBtn')) {
      const toolsSection = document.createElement('section');
      toolsSection.className = 'section-block powershell-dashboard-section';
      toolsSection.innerHTML = `
        <div class="section-title-row"><h2>Tools</h2><span>Direct host access</span></div>
        <div class="primary-launch-grid">
          <button class="primary-launch-card" id="powershellDashboardBtn">
            <span class="launch-icon">›_</span>
            <span class="launch-copy"><strong>PowerShell</strong><small>Paste commands · Text output · No remote desktop</small></span>
            <span class="chevron">›</span>
          </button>
        </div>`;
      connectSection.after(toolsSection);
    }

    const windowsGroup = document.querySelector('#adminMenu .admin-group');
    let adminRow = null;
    if (windowsGroup && !$('powershellConsole')) {
      adminRow = document.createElement('button');
      adminRow.className = 'admin-row powershell-row';
      adminRow.id = 'powershellConsole';
      adminRow.innerHTML = '<span class="admin-row-icon">›_</span><span><strong>PowerShell Console</strong><small>Paste commands and read text output</small></span><span>›</span>';
      windowsGroup.appendChild(adminRow);
    }

    const dialog = document.createElement('dialog');
    dialog.id = 'powershellDialog';
    dialog.className = 'powershell-dialog';
    dialog.innerHTML = `
      <div class="powershell-card">
        <header><div><div class="eyebrow">HOME PC</div><h2>PowerShell Console</h2></div><button id="powershellClose" aria-label="Close">×</button></header>
        <p class="powershell-copy">Paste a command or choose a preset. Presets load into the editor first so you can review them before Run.</p>
        <div class="powershell-quick" aria-label="PowerShell quick commands">
          <button type="button" data-ps-quick="update">Update MRD</button>
          <button type="button" data-ps-quick="status">MRD Status</button>
          <button type="button" data-ps-quick="displays">Displays</button>
          <button type="button" data-ps-quick="chrome">Chrome Windows</button>
          <button type="button" data-ps-quick="workspace">Workspace Probe</button>
          <button type="button" data-ps-quick="logs">Tail Log</button>
          <button type="button" data-ps-quick="restart">Restart MRD</button>
        </div>
        <textarea id="powershellInput" class="powershell-input" maxlength="15900" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Paste PowerShell here…"></textarea>
        <div class="powershell-actions"><button id="powershellClear">Clear</button><button id="powershellCopy">Copy output</button><button id="powershellRun" class="powershell-run">Run</button></div>
        <div class="powershell-output-wrap"><div class="powershell-status"><span id="powershellState">Ready</span><span id="powershellExit"></span></div><pre id="powershellOutput" class="powershell-output">Output will appear here.</pre></div>
      </div>`;
    document.body.appendChild(dialog);

    const quickCommands = {
      update: `Set-Location 'B:\\Mini-Remote-Desktop'\ngit pull --ff-only\ngit rev-parse --short HEAD`,
      status: `Set-Location 'B:\\Mini-Remote-Desktop'\n'=== GIT ==='\ngit status -sb\n"HEAD: $(git rev-parse --short HEAD)"\n'=== MRD LISTENER ==='\nGet-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess`,
      displays: `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Screen]::AllScreens | Select-Object DeviceName,Primary,@{N='X';E={$_.Bounds.X}},@{N='Y';E={$_.Bounds.Y}},@{N='Width';E={$_.Bounds.Width}},@{N='Height';E={$_.Bounds.Height}} | Format-Table -AutoSize\nGet-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'ROOT\\MTTVDD*' -or $_.FriendlyName -match 'Virtual Display Driver' } | Select-Object Status,Class,FriendlyName,InstanceId | Format-Table -AutoSize`,
      chrome: `$src = @'\nusing System;\nusing System.Collections.Generic;\nusing System.Diagnostics;\nusing System.Runtime.InteropServices;\nusing System.Text;\npublic static class MrdChromeDiag {\n  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);\n  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }\n  [DllImport(\"user32.dll\")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);\n  [DllImport(\"user32.dll\")] static extern bool IsWindowVisible(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\n  [DllImport(\"user32.dll\")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);\n  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);\n  public static string Dump() {\n    var lines = new List<string>();\n    EnumWindows(delegate(IntPtr hWnd, IntPtr lp) {\n      if (!IsWindowVisible(hWnd)) return true;\n      uint pid; GetWindowThreadProcessId(hWnd, out pid);\n      try { if (!String.Equals(Process.GetProcessById((int)pid).ProcessName, \"chrome\", StringComparison.OrdinalIgnoreCase)) return true; } catch { return true; }\n      RECT r; if (!GetWindowRect(hWnd, out r)) return true;\n      var title = new StringBuilder(512); GetWindowText(hWnd, title, title.Capacity);\n      lines.Add(String.Format(\"HWND={0} PID={1} X={2} Y={3} W={4} H={5} | {6}\", hWnd.ToInt64(), pid, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, title.ToString()));\n      return true;\n    }, IntPtr.Zero);\n    return lines.Count == 0 ? \"No visible Chrome windows.\" : String.Join(Environment.NewLine, lines);\n  }\n}\n'@\nAdd-Type -TypeDefinition $src\nAdd-Type -AssemblyName System.Windows.Forms\n$target = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Bounds.Width -eq 880 -and $_.Bounds.Height -eq 1912 -and -not $_.Primary } | Select-Object -First 1\nif ($target) { \"MRD TARGET: $($target.DeviceName) X=$($target.Bounds.X) Y=$($target.Bounds.Y) W=$($target.Bounds.Width) H=$($target.Bounds.Height)\" } else { 'MRD TARGET: NOT FOUND' }\n[MrdChromeDiag]::Dump()`,
      workspace: `Set-Location 'B:\\Mini-Remote-Desktop'\n& '.\\scripts\\workspace-capability.ps1'`,
      logs: `Get-Content 'B:\\Mini-Remote-Desktop\\.runtime\\mrd.log' -Tail 80 -ErrorAction SilentlyContinue`,
      restart: `Set-Location 'B:\\Mini-Remote-Desktop'\n.\\Start-MRD.cmd`
    };

    const openConsole = () => {
      dialog.showModal();
      setTimeout(() => $('powershellInput')?.focus(), 50);
    };
    $('powershellDashboardBtn')?.addEventListener('click', openConsole);
    adminRow?.addEventListener('click', openConsole);
    $('powershellClose')?.addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-ps-quick]').forEach(button => {
      button.addEventListener('click', () => {
        const command = quickCommands[button.dataset.psQuick];
        if (!command) return;
        $('powershellInput').value = command;
        $('powershellState').textContent = `${button.textContent.trim()} ready`;
        $('powershellExit').textContent = 'Tap Run';
        $('powershellInput').focus();
      });
    });
    $('powershellClear')?.addEventListener('click', () => {
      $('powershellInput').value = '';
      $('powershellOutput').textContent = 'Output will appear here.';
      $('powershellOutput').dataset.error = 'false';
      $('powershellState').textContent = 'Ready';
      $('powershellExit').textContent = '';
      $('powershellInput').focus();
    });
    $('powershellCopy')?.addEventListener('click', async () => {
      const text = $('powershellOutput')?.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        $('powershellState').textContent = 'Output copied';
      } catch {
        $('powershellState').textContent = 'Copy unavailable';
      }
    });
    $('powershellRun')?.addEventListener('click', () => void runPowerShell());
    $('powershellInput')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void runPowerShell();
      }
    });
  }

  async function runPowerShell() {
    const input = $('powershellInput');
    const output = $('powershellOutput');
    const run = $('powershellRun');
    const command = input?.value || '';
    if (!command.trim()) {
      $('powershellState').textContent = 'Paste a command first';
      input?.focus();
      return;
    }

    run.disabled = true;
    input.disabled = true;
    output.dataset.error = 'false';
    output.textContent = 'Running…';
    $('powershellState').textContent = 'Running on Home PC…';
    $('powershellExit').textContent = '';

    try {
      const response = await fetch('/api/admin/action', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: `powershell:$ProgressPreference='SilentlyContinue';${command}` })
      });
      const body = await response.json();
      if (!response.ok || body.executed === false) throw new Error(body.error || 'PowerShell command failed to start.');
      const sections = [];
      const stderr = cleanPowerShellStderr(body.stderr);
      if (body.stdout) sections.push(body.stdout.trimEnd());
      if (stderr) sections.push(`[stderr]\n${stderr}`);
      output.textContent = sections.join('\n\n') || '(Command completed with no output.)';
      output.dataset.error = String(Number(body.exitCode || 0) !== 0 || Boolean(body.timedOut));
      $('powershellState').textContent = body.timedOut ? 'Timed out' : 'Completed';
      $('powershellExit').textContent = body.timedOut ? '60 s limit' : `Exit ${body.exitCode ?? 0}${body.durationMs != null ? ` · ${body.durationMs} ms` : ''}`;
    } catch (error) {
      output.textContent = error.message;
      output.dataset.error = 'true';
      $('powershellState').textContent = 'Failed';
      $('powershellExit').textContent = '';
    } finally {
      run.disabled = false;
      input.disabled = false;
    }
  }

  function cleanPowerShellStderr(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const marker = '#< CLIXML';
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return text;

    const before = text.slice(0, markerIndex).trim();
    const xml = text.slice(markerIndex + marker.length).trim();
    const progressOnly = /<Objs\b/i.test(xml)
      && /<Obj S="progress"/i.test(xml)
      && !/<Obj S="(?!progress)[^"]+"/i.test(xml);
    return progressOnly ? before : text;
  }

  function updateBrowserCopy() {
    const dashboard = $('browserBtn');
    if (dashboard) {
      const small = dashboard.querySelector('small');
      if (small) small.textContent = 'Actual Chrome · Normal or Incognito';
    }
    const command = $('commandBrowser');
    if (command) {
      const small = command.querySelector('small');
      if (small) small.textContent = 'Normal or Incognito window';
    }
  }
})();
