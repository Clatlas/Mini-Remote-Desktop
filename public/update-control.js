(() => {
  const button = document.getElementById('commandUpdate');
  if (!button) return;

  const label = button.querySelector('strong');
  const detail = button.querySelector('small');
  const defaultLabel = label?.textContent || 'Update MRD';
  const defaultDetail = detail?.textContent || 'Pull latest GitHub code and restart MRD';

  button.addEventListener('click', async () => {
    const approved = window.confirm(
      'Update MRD?\n\nMRD will run git pull --ff-only, then run Start-MRD.cmd. The remote connection will briefly disconnect while the host restarts.'
    );
    if (!approved) return;

    button.disabled = true;
    if (label) label.textContent = 'Updating MRD…';
    if (detail) detail.textContent = 'Pulling GitHub and restarting the host';
    toast('MRD update started');

    const startedAt = Date.now();
    try {
      const response = await fetch('/api/apps/update-mrd/launch', {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      let result = {};
      try { result = await response.json(); } catch {}
      if (!response.ok || !result.ok) throw new Error(result.error || `${response.status} ${response.statusText}`);

      await monitorUpdate(startedAt);
    }
    catch (error) {
      restoreButton();
      toast(error.message || 'Could not start MRD update');
    }
  });

  // If this page was loaded immediately after an updater-driven restart, surface
  // the final result once instead of making the user inspect a PowerShell log.
  setTimeout(() => showRecentResult(), 1200);

  async function monitorUpdate(startedAt) {
    let sawHostOffline = false;
    const deadline = Date.now() + 120000;

    while (Date.now() < deadline) {
      const result = await readUpdateResult();
      if (result && Number(result.at || 0) >= startedAt - 2000) {
        if (result.state === 'failed') {
          restoreButton();
          toast(result.message || 'MRD update failed');
          return;
        }
        if (result.state === 'success') {
          toast('MRD updated · reloading');
          await delay(800);
          location.reload();
          return;
        }
      }

      try {
        const status = await fetch(`/api/status?update=${Date.now()}`, { cache: 'no-store' });
        if (!status.ok) throw new Error('Host unavailable');
        if (sawHostOffline) {
          toast('MRD is back online · loading update');
          await delay(1200);
          location.reload();
          return;
        }
      }
      catch {
        sawHostOffline = true;
      }

      await delay(1200);
    }

    restoreButton();
    toast('Update is taking longer than expected. MRD may still be restarting.');
  }

  async function showRecentResult() {
    const result = await readUpdateResult();
    if (!result) return;
    const age = Date.now() - Number(result.at || 0);
    if (age < 0 || age > 180000) return;

    if (result.state === 'success') toast('MRD update completed successfully');
    else if (result.state === 'failed') toast(result.message || 'MRD update failed');
  }

  async function readUpdateResult() {
    try {
      const response = await fetch(`/update-result.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) return null;
      return await response.json();
    }
    catch {
      return null;
    }
  }

  function restoreButton() {
    button.disabled = false;
    if (label) label.textContent = defaultLabel;
    if (detail) detail.textContent = defaultDetail;
  }

  function toast(text) {
    const target = document.getElementById('toast');
    if (!target) return;
    target.textContent = text;
    target.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove('show'), 4200);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
