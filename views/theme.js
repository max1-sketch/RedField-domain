(function () {
    window.RF = window.RF || {};

    // ---------------------------------------------------------------------------
    // COOKIE UTILITIES
    // ---------------------------------------------------------------------------
    RF.getCookie = function (name) {
        if (!document.cookie) return null;
        const cookies = document.cookie.split(';');
        for (let c of cookies) {
            const [k, v] = c.trim().split('=');
            if (k === name) return decodeURIComponent(v || '');
        }
        return null;
    };

    RF.setCookie = function (name, value, seconds) {
        let expires = '';
        if (seconds) {
            const date = new Date();
            date.setTime(date.getTime() + (seconds * 1000));
            expires = `; expires=${date.toUTCString()}`;
        }
        document.cookie = `${name}=${encodeURIComponent(value || '')}${expires}; path=/; SameSite=Lax`;
    };

    // ---------------------------------------------------------------------------
    // API CALL HELPER
    // ---------------------------------------------------------------------------
    RF.apiCall = async function (endpoint, options = {}) {
        const defaultHeaders = { 'Content-Type': 'application/json' };
        options.headers = { ...defaultHeaders, ...(options.headers || {}) };

        const response = await fetch(endpoint, options);
        if (!response.ok) {
            let errorMsg = 'API request failed';
            try {
                const errData = await response.json();
                errorMsg = errData.error || errorMsg;
            } catch (e) {}
            throw new Error(errorMsg);
        }
        return response.json();
    };

    // ---------------------------------------------------------------------------
    // INJECTED CSS STYLES (THEME, TOASTS, LOADERS, & MODALS)
    // ---------------------------------------------------------------------------
    if (!document.getElementById('rf-clean-theme-styles')) {
        const style = document.createElement('style');
        style.id = 'rf-clean-theme-styles';
        style.textContent = `
            :root {
                --sidebar-bg: #0d0f16;
                --panel-bg: #141722;
                --border-color: #262b3a;
                --text-main: #e7e9ee;
                --text-muted: #9199a8;
                --accent: #d69a4e;
            }

            body {
                background-color: #0a0c11 !important;
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
                font-size: 13.5px !important;
                font-weight: 500 !important;
                padding: 9px 13px !important;
                border-radius: 8px !important;
                margin-bottom: 2px !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                text-decoration: none !important;
                transition: background 0.15s, color 0.15s !important;
            }

            .nav-item:hover {
                background: #1a1e2b !important;
                color: var(--text-main) !important;
            }

            .nav-item.active {
                background: var(--accent) !important;
                color: #0a0c11 !important;
                font-weight: 700 !important;
            }

            .nav-item.active .ic {
                color: #0a0c11 !important;
            }

            /* Custom Minimal Scrollbar */
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: #0a0c11; }
            ::-webkit-scrollbar-thumb { background: #262b3a; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: #3b4256; }

            /* Toast Notifications Container & Stack */
            #rf-toast-container, #toastStack { position: fixed; top: 18px; right: 18px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; max-width: 320px; }
            .rf-toast, .toast { background: #1a1e2b; border: 1px solid #262b3a; color: #e7e9ee; padding: 10px 16px; border-radius: 6px; font-size: 12.5px; font-weight: 600; opacity: 0; transform: translateY(-10px); transition: opacity .2s, transform .2s; box-shadow: 0 12px 34px rgba(0,0,0,.45); }
            .rf-toast.show, .toast { opacity: 1; transform: translateY(0); }
            .rf-toast.success, .toast:not(.error) { border-left: 3px solid #22c55e; }
            .rf-toast.error, .toast.error { border-left: 3px solid #ef4444; }

            /* Button Animated Loader Dots */
            .rf-loader-dots span { animation: rfDotPulse 1.2s infinite; opacity: 0.2; }
            .rf-loader-dots span:nth-child(2) { animation-delay: 0.2s; }
            .rf-loader-dots span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes rfDotPulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }

            /* Custom Prompt Modal */
            .rf-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 9998; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .2s; }
            .rf-modal-overlay.visible { opacity: 1; }
            .rf-modal-card { background: #141722; border: 1px solid #262b3a; border-radius: 10px; padding: 24px; width: 100%; max-width: 380px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
            .rf-modal-card h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: #e7e9ee; }
            .rf-modal-input { width: 100%; background: #0a0c11; border: 1px solid #262b3a; color: #e7e9ee; padding: 10px 12px; border-radius: 6px; font-size: 13px; outline: none; margin-bottom: 16px; }
            .rf-modal-input:focus { border-color: #d69a4e; }
            .rf-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
            .rf-modal-btn { background: #1a1e2b; border: 1px solid #262b3a; color: #e7e9ee; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
            .rf-modal-btn.confirm { background: #d69a4e; color: #0a0c11; border: none; font-weight: 700; }
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

    RF.startSessionClock = function (element) {
        if (!element) return;

        function update() {
            const rawVal = RF.getCookie('sessionExpires');
            const expiresAt = rawVal ? parseInt(rawVal, 10) : null;

            if (!expiresAt || isNaN(expiresAt)) {
                element.textContent = 'session --:--';
                return;
            }

            const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            element.textContent = `session ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            if (remaining === 0) {
                window.location.href = '/login';
            }
        }

        update();
        setInterval(update, 1000);
    };

    // ---------------------------------------------------------------------------
    // TOAST NOTIFICATIONS & BUTTON LOADERS
    // ---------------------------------------------------------------------------
    RF.toast = function (message, isSuccess = true) {
        let container = document.getElementById('rf-toast-container') || document.getElementById('toastStack');
        if (!container) {
            container = document.createElement('div');
            container.id = 'rf-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `rf-toast ${isSuccess ? 'success' : 'error'}`;
        toast.textContent = message;
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 250);
        }, 3000);
    };

    RF.showToast = RF.toast;

    RF.withLoader = async function (btn, asyncFn, successMsg = 'Changes saved successfully!') {
        if (!btn || btn.disabled) return;
        const originalContent = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="rf-loader-dots"><span>.</span><span>.</span><span>.</span></span>`;

        try {
            await asyncFn();
            if (successMsg) RF.toast(successMsg, true);
        } catch (err) {
            RF.toast(err.message || 'Failed to save changes. Please try again.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    };

    RF.withLoading = async function (btn, asyncFn, options = {}) {
        const okMsg = typeof options === 'string' ? options : (options.okMessage || 'Success');
        const failMsg = typeof options === 'object' ? options.failMessage : 'Error';
        return RF.withLoader(btn, asyncFn, okMsg);
    };

    // ---------------------------------------------------------------------------
    // CUSTOM PROMPT MODAL
    // ---------------------------------------------------------------------------
    RF.promptModal = function ({ title = 'Enter Value', placeholder = 'Type here...', confirmText = 'Confirm' }) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'rf-modal-overlay';
            overlay.innerHTML = `
                <div class="rf-modal-card">
                    <h3>${RF.esc(title)}</h3>
                    <input type="text" class="rf-modal-input" placeholder="${RF.esc(placeholder)}" />
                    <div class="rf-modal-actions">
                        <button class="rf-modal-btn cancel">Cancel</button>
                        <button class="rf-modal-btn confirm">${RF.esc(confirmText)}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            const input = overlay.querySelector('.rf-modal-input');
            const confirmBtn = overlay.querySelector('.confirm');
            const cancelBtn = overlay.querySelector('.cancel');

            requestAnimationFrame(() => overlay.classList.add('visible'));
            input.focus();

            function close(value) {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 200);
                resolve(value);
            }

            confirmBtn.addEventListener('click', () => close(input.value.trim() || null));
            cancelBtn.addEventListener('click', () => close(null));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') close(input.value.trim() || null);
                if (e.key === 'Escape') close(null);
            });
        });
    };

    // ---------------------------------------------------------------------------
    // SIDEBAR CATEGORIZATION & RENDERING
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
        settings: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        logout: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`
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

RF.renderNav = function (currentPath, allowedTabs, viewerTier) {
        // Automatically render Member Portal tabs for member paths or member tiers
        const isMember = currentPath.startsWith('/my-') || viewerTier === 'member' || viewerTier === 'none' || (allowedTabs && allowedTabs.isMember);

        if (isMember) {
            return `
                <div class="nav-section-title">PORTAL</div>
                <a href="/my-dashboard" class="nav-item ${currentPath === '/my-dashboard' ? 'active' : ''}">
                    <span class="ic">${RF.ICONS.tickets || '📁'}</span>
                    <span>Overview &amp; Tickets</span>
                </a>
                <a href="/my-applications" class="nav-item ${currentPath === '/my-applications' ? 'active' : ''}">
                    <span class="ic">${RF.ICONS.auditlog || '📝'}</span>
                    <span>Applications</span>
                </a>
                <a href="/my-feedback" class="nav-item ${currentPath === '/my-feedback' ? 'active' : ''}">
                    <span class="ic">${RF.ICONS.feedback || '⭐'}</span>
                    <span>Feedback</span>
                </a>
                
                <div class="nav-section-title">ACCOUNT</div>
                <a href="/account" class="nav-item ${currentPath === '/account' ? 'active' : ''}">
                    <span class="ic">${RF.ICONS.settings || '⚙️'}</span>
                    <span>Appearance Settings</span>
                </a>
            `;
        }

        return NAV_GROUPS.map(group => {
            const visibleItems = group.items.filter(item => {
                if (!Array.isArray(allowedTabs) || !allowedTabs.length) return true;
                return allowedTabs.includes(item.key);
            });

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