window.RF = (function () {
  const TYPE_COLORS = { REDFIELD: '#22c55e', MANAGEMENT: '#3b82f6', BUG: '#f59e0b' };
  const FALLBACK_COLOR = '#a78bfa';

  function typeColor(type) { return TYPE_COLORS[type] || FALLBACK_COLOR; }
  function esc(str) {
    return (str === undefined || str === null ? '' : String(str))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function startSessionClock(el) {
    if (!el) return;
    function tick() {
      const expiresAt = parseInt(getCookie('sessionExpires') || '0', 10);
      if (!expiresAt) { el.textContent = 'session active'; return; }
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const m = Math.floor(remaining / 60), s = remaining % 60;
      el.textContent = `session ${m}:${s.toString().padStart(2, '0')}`;
      el.classList.toggle('warn', remaining <= 60);
      if (remaining <= 0) window.location.reload();
    }
    tick(); setInterval(tick, 1000);
  }

  const ICONS = {
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path></svg>',
    tickets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"></path></svg>',
    panels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
    tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
    quickwords: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
    feedback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    auditlog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    blacklist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m4.93 4.93 14.14 14.14"></path></svg>',
    lookup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>'
  };

  function renderNav(activePath, allowedTabs) {
    const tabs = [
      { key: 'archive', href: '/', label: 'Home', ic: ICONS.archive },
      { key: 'tickets', href: '/tickets', label: 'Open Tickets', ic: ICONS.tickets },
      { key: 'panels', href: '/panels', label: 'Panel Configs', ic: ICONS.panels },
      { key: 'tags', href: '/tags', label: 'Tags', ic: ICONS.tags },
      { key: 'quickwords', href: '/quickwords', label: 'Quick Words', ic: ICONS.quickwords },
      { key: 'feedback', href: '/feedback', label: 'Feedback', ic: ICONS.feedback },
      { key: 'auditlog', href: '/audit-log', label: 'Logging', ic: ICONS.auditlog, adminOnly: true },
      { key: 'moderation', href: '/moderation', label: 'Moderation', ic: ICONS.shield },
      { key: 'lookup', href: '/lookup', label: 'User Lookup <span class="badge-beta">BETA</span>', ic: ICONS.lookup },
      { key: 'blacklist', href: '/blacklist', label: 'Blacklist', ic: ICONS.blacklist },
      { key: 'settings', href: '/settings', label: 'Server Configs', ic: ICONS.settings, adminOnly: true }
    ];

    const visible = (allowedTabs && Array.isArray(allowedTabs) && allowedTabs.length > 0)
      ? tabs.filter(t => !t.adminOnly && allowedTabs.includes(t.key))
      : tabs;

    return visible.map(t => `<a class="nav-item${t.href === activePath ? ' active' : ''}" href="${t.href}"><span class="ic">${t.ic}</span> ${t.label}</a>`).join('');
  }

  return { typeColor, esc, getCookie, startSessionClock, renderNav, ICONS };
})();