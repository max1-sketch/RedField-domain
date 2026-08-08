(function () {
    window.RF = window.RF || {};

    // ---------------------------------------------------------------------------
    // CLEAN DASHBOARD STYLES & HIGHLIGHTS
    // ---------------------------------------------------------------------------
    if (!document.getElementById('rf-clean-theme-styles')) {
        const style = document.createElement('style');
        style.id = 'rf-clean-theme-styles';
        style.textContent = `
            :root {
                --sidebar-bg: #0c0e14;
                --panel-bg: #131720;
                --border-color: #222735;
                --text-main: #e3e6ed;
                --text-muted: #8891a0;
                --accent: #d69a4e;
            }

            body {
                background-color: #0b0d12 !important;
                color: var(--text-main) !important;
            }

            .card, .login-card {
                background: var(--panel-bg) !important;
                border: 1px solid var(--border-color) !important;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
            }

            .sidebar {
                background: var(--sidebar-bg) !important;
                border-right: 1px solid var(--border-color) !important;
            }

            .nav-section-title {
                font-size: 10px !important;
                font-weight: 800 !important;
                color: #525a6b !important;
                letter-spacing: 0.08em !important;
                text-transform: uppercase !important;
                padding: 18px 12px 6px !important;
            }

            .nav-item {
                color: var(--text-muted) !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                padding: 8px 12px !important;
                border-radius: 6px !important;
                margin-bottom: 2px !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                text-decoration: none !important;
                transition: background 0.15s, color 0.15s !important;
            }

            .nav-item:hover {
                background: #161a24 !important;
                color: var(--text-main) !important;
            }

            .nav-item.active {
                background: #1c212e !important;
                color: #ffffff !important;
                font-weight: 700 !important;
            }

            .nav-item.active .ic {
                color: var(--accent) !important;
            }

            /* Custom Minimal Scrollbar */
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: #0b0d12; }
            ::-webkit-scrollbar-thumb { background: #222735; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: #3b4256; }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------------
    // UTILITY FUNCTIONS
    // ---------------------------------------------------------------------------

    RF.esc = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    RF.typeColor = function (type) {
        if (!type) return '#5865f2';
        const t = String(type).toUpperCase();
        if (t.includes('BUG')) return '#f1c40f';
        if (t.includes('MANAGEMENT')) return '#5865f2';
        if (t.includes('REDFIELD') || t.includes('SUPPORT')) return '#2ecc71';
        return '#d69a4e';
    };

    // ---------------------------------------------------------------------------
    // SIDEBAR CATEGORIZATION & RENDERING (FULL TABS RESTORED)
    // ---------------------------------------------------------------------------

    RF.ICONS = {
        archive: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h20v5H1zM10 12h4"/></svg>`,
        tickets: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5v2m0 4v2m0 4v2M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/></svg>`,
        panels: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
        tags: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"/></svg>`,
        feedback: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        moderation: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        lookup: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        blacklist: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        shiftroster: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        auditlog: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        settings: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
    };

    const NAV_GROUPS = [
        {
            title: 'WORKSPACE',
            items: [
                { path: '/', label: 'Dashboard', key: 'archive' },
                { path: '/tickets', label: 'Open Tickets', key: 'tickets' },
                { path: '/panels', label: 'Panel Settings', key: 'panels' }
            ]
        },
        {
            title: 'MANAGEMENT',
            items: [
                { path: '/moderation', label: 'Moderation', key: 'moderation' },
                { path: '/lookup', label: 'Members', key: 'lookup' },
                { path: '/blacklist', label: 'Blacklist', key: 'blacklist' },
                { path: '/tags', label: 'Tags', key: 'tags' }
            ]
        },
        {
            title: 'STAFF',
            items: [
                { path: '/shift-roster', label: 'Staff Shifts', key: 'shiftroster' },
                { path: '/feedback', label: 'Feedback', key: 'feedback' }
            ]
        },
        {
            title: 'SYSTEM',
            items: [
                { path: '/audit-log', label: 'Audit Log', key: 'auditlog' },
                { path: '/settings', label: 'Server Settings', key: 'settings' }
            ]
        }
    ];

    RF.renderNav = function (currentPath, allowedTabs) {
        return NAV_GROUPS.map(group => {
            const visibleItems = group.items.filter(item => !Array.isArray(allowedTabs) || allowedTabs.includes(item.key));
            if (!visibleItems.length) return '';

            const itemsHtml = visibleItems.map(item => {
                const isActive = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(item.path));
                const iconSvg = RF.ICONS[item.key] || '';
                
                return `
                    <a href="${item.path}" class="nav-item ${isActive ? 'active' : ''}">
                        <span class="ic">${iconSvg}</span>
                        <span>${RF.esc(item.label)}</span>
                    </a>
                `;
            }).join('');

            return `
                <div class="nav-section-title">${group.title}</div>
                ${itemsHtml}
            `;
        }).join('');
    };
})();