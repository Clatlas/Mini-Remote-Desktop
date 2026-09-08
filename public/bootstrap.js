// MRD bootstrap compatibility bridge.
// app.js still binds the legacy Browser callback during startup. The managed
// Chrome controller owns the actual Browser click in chrome-window.js, but
// this definition must exist before app.js executes so one stale symbol cannot
// abort the rest of MRD's UI event binding.
window.openBrowserPreview = window.openBrowserPreview || function openBrowserPreview() {
  const browser = document.getElementById('browserBtn');
  if (browser) {
    // chrome-window.js installs a capture-phase handler on this button and owns
    // the actual connection setup. This function is only a safe fallback.
    browser.dispatchEvent(new CustomEvent('mrd-browser-bootstrap', { bubbles: false }));
  }
};
