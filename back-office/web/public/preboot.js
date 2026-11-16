// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

// Marks the page before the console loads, for the loading skeleton. A file of
// its own: the console's Content-Security-Policy (script-src 'self') refuses
// inline scripts.
try {
  document.documentElement.classList.add(sessionStorage.getItem('plr.token') ? 'has-session' : 'no-session');
} catch (_) {
  document.documentElement.classList.add('no-session');
}
