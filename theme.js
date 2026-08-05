// Shared across index.html / transcript.html / settings.html so the three pages
// don't drift out of sync with each other over time.
window.RF = (function () {
  const TYPE_COLORS = {
    REDFIELD: '#6fa383',
    MANAGEMENT: '#5c7d99',
    BUG: '#c17a3f'
  };
  const FALLBACK_COLOR = '#8d7bb0';

  function typeColor(type) {
    return TYPE_COLORS[type] || FALLBACK_COLOR;
  }

  function esc(str) {
    return (str === undefined || str === null ? '' : String(str))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initials(tag) {
    if (!tag) return '?';
    return tag.split('#')[0].slice(0, 2).toUpperCase();
  }

  function fmtDateTime(iso) {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtDay(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown date';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isStaffSession() {
    return Boolean(getCookie('ticketAuth'));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (err) { reject(err); }
      finally { document.body.removeChild(ta); }
    });
  }

  // Wires up a "session N:SS" clock element + auto-reload when it hits zero,
  // reading the non-HttpOnly sessionExpires cookie the server sets on login.
  function startSessionClock(el) {
    function tick() {
      const expiresAt = parseInt(getCookie('sessionExpires') || '0', 10);
      if (!expiresAt) { el.textContent = 'session --:--'; return; }
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const m = Math.floor(remaining / 60), s = remaining % 60;
      el.textContent = `session ${m}:${s.toString().padStart(2, '0')}`;
      el.classList.toggle('warn', remaining <= 60);
      if (remaining <= 0) window.location.reload();
    }
    tick();
    setInterval(tick, 1000);
  }

  // Builds the small nav strip shared by all three pages, marking whichever
  // tab matches the current path as active.
  function renderNav(activePath) {
    const tabs = [
      { href: '/', label: 'Archive' },
      { href: '/settings', label: 'Settings' }
    ];
    return tabs.map(t => `<a class="rf-tab${t.href === activePath ? ' active' : ''}" href="${t.href}">${t.label}</a>`).join('');
  }

  return { typeColor, esc, initials, fmtDateTime, fmtDay, fmtTime, getCookie, isStaffSession, copyText, startSessionClock, renderNav };
})();