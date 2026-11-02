import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Starts the service worker (public/sw.js) so browsers treat this as an installable app.
// Only on the live https site, never on a local dev page.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ }); });
}

// After an update, a tab that was already open can ask for a file that no longer exists ("Failed to fetch dynamically imported module").
// Reload once so the page picks up the new version. Jobs and drawings are saved on every change, so nothing is lost; the guard stops any reload loop.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('nl-stale-reload') || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem('nl-stale-reload', String(Date.now()));
  } catch { /* storage off: reload anyway */ }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
