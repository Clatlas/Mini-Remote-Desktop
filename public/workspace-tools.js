(() => {
  const $ = id => document.getElementById(id);
  const COMMAND = `Set-Location 'B:\\Mini-Remote-Desktop'\n& '.\\scripts\\workspace-capability.ps1'`;

  function install() {
    const quick = document.querySelector('.powershell-quick');
    if (quick && !quick.querySelector('[data-ps-workspace]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.psWorkspace = 'true';
      button.textContent = 'Workspace Probe';
      button.addEventListener('click', () => loadProbe());
      quick.appendChild(button);
    }

    const admin = document.querySelector('#adminMenu');
    if (admin && !$('workspaceProbeAdmin')) {
      const group = document.createElement('div');
      group.className = 'admin-group';
      group.innerHTML = `
        <button class="admin-row" id="workspaceProbeAdmin">
          <span class="admin-row-icon">◇</span>
          <span><strong>Workspace Isolation</strong><small>Probe VM / Hyper-V capability</small></span>
          <span>›</span>
        </button>`;
      admin.appendChild(group);
      $('workspaceProbeAdmin')?.addEventListener('click', () => {
        $('powershellDialog')?.showModal();
        setTimeout(loadProbe, 40);
      });
    }
  }

  function loadProbe() {
    const input = $('powershellInput');
    if (!input) return;
    input.value = COMMAND;
    if ($('powershellState')) $('powershellState').textContent = 'Workspace Probe ready';
    if ($('powershellExit')) $('powershellExit').textContent = 'Tap Run';
    input.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
  else setTimeout(install, 0);

  // extras.js builds the PowerShell UI after initial script evaluation.
  for (const delay of [100, 350, 900, 1800]) setTimeout(install, delay);
})();
