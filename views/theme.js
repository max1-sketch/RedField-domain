(function () {
    window.RF = window.RF || {};

    // ---------------------------------------------------------------------------
    // CLEAN, DENSE DASHBOARD STYLES (Reduced Gold Accent & Improved Hierarchy)
    // ---------------------------------------------------------------------------
    if (!document.getElementById('rf-clean-theme-styles')) {
        const style = document.createElement('style');
        style.id = 'rf-clean-theme-styles';
        style.textContent = `
            /* Reduced Gold Accent Palette & Dark Neutral Base */
            :root {
                --sidebar-bg: #0c0e14;
                --panel-bg: #131720;
                --border-color: #222735;
                --text-main: #e3e6ed;
                --text-muted: #8891a0;
            }

            body {
                background-color: #0b0d12 !important;
                color: var(--text-main) !important;
            }

            /* Clean Glass Panels (Without Neon Gold Glows) */
            .card, .login-card, .art-hero-container {
                background: var(--panel-bg) !important;
                border: 1px solid var(--border-color) !important;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
            }

            /* Categorized Sidebar Navigation */
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

            /* High-Density Functional Tables */
            table.dense-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
                background: var(--panel-bg);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                overflow: hidden;
            }

            table.dense-table th {
                text-align: left;
                padding: 12px 14px;
                color: var(--text-muted);
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                border-bottom: 1px solid var(--border-color);
                background: rgba(255, 255, 255, 0.02);
            }

            table.dense-table td {
                padding: 12px 14px;
                border-bottom: 1px solid var(--border-color);
                color: var(--text-main);
            }

            table.dense-table tr:last-child td {
                border-bottom: none;
            }

            /* Custom Minimal Scrollbar */
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: #0b0d12; }
            ::-webkit-scrollbar-thumb { background: #222735; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: #3b4256; }

            /* Bouncing Dot Loader */
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

            /* Toast Stack & Floating Alerts */
            #toastStack {
                position: fixed;
                top: 18px;
                right: 18px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 340px;
            }
            .toast {
                background: #141722;
                border: 1px solid #262b3a;
                border-left: 4px solid #22c55e;
                border-radius: 8px;
                padding: 12px 16px;
                font-size: 13px;
                color: #e7e9ee;
                box-shadow: 0 12px 34px rgba(0,0,0,0.5);
                animation: toastin 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            .toast.error { border-left-color: #ef4444; }
            .toast .toast-title { font-weight: 800; margin-bottom: 2px; }
            .toast.fading { animation: toastout 0.25s forwards; }
            @keyframes toastin { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
            @keyframes toastout { to { opacity: 0; transform: translateX(30px); } }
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

    RF.apiCall = async function (endpoint, options = {}) {
        options.headers = options.headers || {};
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch(endpoint, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    };

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

    RF.typeColor = function (type) {
        if (!type) return '#5865f2';
        const t = String(type).toUpperCase();
        if (t.includes('BUG')) return '#f1c40f';
        if (t.includes('MANAGEMENT')) return '#5865f2';
        if (t.includes('REDFIELD') || t.includes('SUPPORT')) return '#2ecc71';
        return '#d69a4e';
    };

    RF.playChime = function () {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) {}
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
        settings: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
    };

    const NAV_GROUPS = [
        {
            title: 'WORKSPACE',
            items: [
                { path: '/staff', label: 'Dashboard', key: 'archive' },
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
                const isActive = currentPath === item.path || (item.path !== '/staff' && currentPath.startsWith(item.path));
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
})();