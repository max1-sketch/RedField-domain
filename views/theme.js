(function () {
    window.RF = window.RF || {};

    // Inject Global Badge, Loader & Toast Styles
    if (!document.getElementById('rf-theme-styles')) {
        const style = document.createElement('style');
        style.id = 'rf-theme-styles';
        style.textContent = `
            .badge-beta {
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
                background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.08)) !important;
                color: #fbbf24 !important;
                border: 1px solid rgba(245, 158, 11, 0.4) !important;
                font-size: 10px !important;
                font-weight: 800 !important;
                padding: 2px 8px !important;
                border-radius: 20px !important;
                margin-left: auto !important;
                text-transform: uppercase !important;
                letter-spacing: 0.06em !important;
                box-shadow: 0 0 12px rgba(245, 158, 11, 0.2) !important;
            }
            .badge-beta::before {
                content: '' !important;
                width: 6px !important;
                height: 6px !important;
                border-radius: 50% !important;
                background-color: #f59e0b !important;
                box-shadow: 0 0 6px #f59e0b !important;
                animation: betaPulse 1.8s infinite ease-in-out !important;
            }

            .badge-coming-soon {
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
                background: rgba(239, 68, 68, 0.15) !important;
                color: #f87171 !important;
                border: 1px solid rgba(239, 68, 68, 0.3) !important;
                font-size: 9.5px !important;
                font-weight: 800 !important;
                padding: 2px 8px !important;
                border-radius: 20px !important;
                margin-left: auto !important;
                text-transform: uppercase !important;
                letter-spacing: 0.05em !important;
            }

            .nav-item.disabled-tab {
                opacity: 0.45 !important;
                cursor: not-allowed !important;
                user-select: none !important;
                text-decoration: line-through !important;
                text-decoration-color: rgba(239, 68, 68, 0.6) !important;
            }
            .nav-item.disabled-tab:hover {
                background: transparent !important;
                color: var(--muted) !important;
            }

            @keyframes betaPulse {
                0%, 100% { opacity: 0.4; transform: scale(0.85); }
                50% { opacity: 1; transform: scale(1.2); }
            }

            /* Bouncing 3D Loading Dots */
            .dot-loader {
                display: inline-flex;
                gap: 4px;
                align-items: center;
                justify-content: center;
            }
            .dot-loader span {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: currentColor;
                animation: dotbounce 1s infinite ease-in-out;
            }
            .dot-loader span:nth-child(2) { animation-delay: 0.15s; }
            .dot-loader span:nth-child(3) { animation-delay: 0.30s; }
            @keyframes dotbounce {
                0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
                40% { transform: scale(1.2); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    // Toast Notification System
    RF.toast = function (message, isSuccess = true) {
        let stack = document.getElementById('toastStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toastStack';
            document.body.appendChild(stack);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${isSuccess ? 'success' : 'error'}`;
        toast.innerHTML = `<div class="toast-title">${isSuccess ? '✅ Success' : '⚠️ Error'}</div><div>${RF.esc(message)}</div>`;

        stack.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fading');
            setTimeout(() => toast.remove(), 250);
        }, 3500);
    };

    // Button Loading State Handler (Shows 3 Bouncing Dots)
    RF.withLoading = async function (buttonElement, actionPromise, options = {}) {
        if (!buttonElement) return await actionPromise();

        const originalHtml = buttonElement.innerHTML;
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="dot-loader"><span></span><span></span><span></span></span>`;

        try {
            const result = await actionPromise();
            if (options.okMessage) RF.toast(options.okMessage, true);
            return result;
        } catch (err) {
            const errMsg = options.failMessage ? `${options.failMessage}: ${err.message}` : err.message;
            RF.toast(errMsg, false);
            throw err;
        } finally {
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalHtml;
        }
    };

    // HTML Escaping Utility
    RF.esc = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // Cookie Utilities
    RF.getCookie = function (name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
        return null;
    };

    RF.setCookie = function (name, value, days = 30) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
    };

    // Generic API Call Helper
    RF.apiCall = async function (endpoint, options = {}) {
        options.headers = options.headers || {};
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch(endpoint, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    };

    // Ticket Type Color Helper
    RF.typeColor = function (type) {
        if (!type) return '#5865f2';
        const t = String(type).toUpperCase();
        if (t.includes('BUG')) return '#f1c40f';
        if (t.includes('MANAGEMENT')) return '#5865f2';
        if (t.includes('REDFIELD') || t.includes('SUPPORT')) return '#2ecc71';
        return '#d69a4e';
    };

    // Sidebar Icons
    RF.ICONS = {
        archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h20v5H1zM10 12h4"/></svg>`,
        tickets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5v2m0 4v2m0 4v2M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/></svg>`,
        panels: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
        tags: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"/></svg>`,
        quickwords: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        feedback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        moderation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        lookup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        blacklist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        shiftroster: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        auditlog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`
    };

    const ALL_NAV_ITEMS = [
        { path: '/', label: 'Archive', key: 'archive' },
        { path: '/tickets', label: 'Open Tickets', key: 'tickets' },
        { path: '/panels', label: 'Panels', key: 'panels' },
        { path: '/tags', label: 'Tags', key: 'tags' },
        { path: '#', label: 'Quick Words', key: 'quickwords', badge: 'disabled', disabled: true },
        { path: '/feedback', label: 'Feedback', key: 'feedback' },
        { path: '/moderation', label: 'Moderation', key: 'moderation' },
        { path: '/lookup', label: 'User Lookup', key: 'lookup', badge: 'beta' },
        { path: '/blacklist', label: 'Blacklist', key: 'blacklist' },
        { path: '/shift-roster', label: 'Shift Roster', key: 'shiftroster', badge: 'beta' },
        { path: '/audit-log', label: 'Audit Log', key: 'auditlog' },
        { path: '/settings', label: 'Server Configs', key: 'settings' }
    ];

    RF.renderNav = function (currentPath, allowedTabs) {
        return ALL_NAV_ITEMS.map(item => {
            if (Array.isArray(allowedTabs) && !allowedTabs.includes(item.key)) {
                return '';
            }
            const isActive = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(item.path));
            const iconSvg = RF.ICONS[item.key] || '';
            
            let badgeHtml = '';
            if (item.badge === 'disabled') {
                badgeHtml = `<span class="badge-coming-soon">Soon</span>`;
            } else if (item.badge === 'beta') {
                badgeHtml = `<span class="badge-beta">Beta</span>`;
            }

            if (item.disabled) {
                return `
                    <a href="javascript:void(0);" onclick="alert('Coming soon, sorry! This feature is under development.');" class="nav-item disabled-tab">
                        <span class="ic">${iconSvg}</span>
                        <span>${RF.esc(item.label)}</span>
                        ${badgeHtml}
                    </a>
                `;
            }

            return `
                <a href="${item.path}" class="nav-item ${isActive ? 'active' : ''}">
                    <span class="ic">${iconSvg}</span>
                    <span>${RF.esc(item.label)}</span>
                    ${badgeHtml}
                </a>
            `;
        }).join('');
    };

    RF.startSessionClock = function (element) {
        if (!element) return;

        function update() {
            let expiresAt = null;
            const cookies = document.cookie.split(';');
            for (let c of cookies) {
                const [k, v] = c.trim().split('=');
                if (k === 'sessionExpires') { expiresAt = parseInt(v, 10); break; }
            }

            if (!expiresAt || isNaN(expiresAt)) {
                element.textContent = 'session --:--';
                element.classList.remove('warn');
                return;
            }

            const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            element.textContent = `session ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            if (remaining <= 60) {
                element.classList.add('warn');
            } else {
                element.classList.remove('warn');
            }

            if (remaining === 0) {
                window.location.href = '/login';
            }
        }

        update();
        setInterval(update, 1000);
    };
})();