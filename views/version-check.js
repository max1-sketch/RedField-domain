(function () {
    const clientVersion = window.APP_BUILD_VERSION;
    if (!clientVersion) {
        console.warn('[version-check] window.APP_BUILD_VERSION is not set — the toast can never fire. This means the server-side template injection that sets it is missing on this page.');
        return;
    }
    console.debug('[version-check] running. client build =', clientVersion);

    let isOutdated = false;
    let pollTimer = null;

    function checkServerVersion() {
        fetch('/api/version')
            .then(res => {
                if (!res.ok) {
                    console.warn('[version-check] /api/version returned', res.status, '— can\'t compare versions.');
                    return null;
                }
                return res.json();
            })
            .then(data => {
                if (!data) return;
                if (!data.version) {
                    console.warn('[version-check] /api/version response had no "version" field:', data);
                    return;
                }
                if (data.version !== clientVersion && !isOutdated) {
                    console.info('[version-check] mismatch detected — server =', data.version, 'client =', clientVersion, '. Showing update toast.');
                    isOutdated = true;
                    if (pollTimer) clearInterval(pollTimer);
                    renderUpdateToast();
                }
            })
            .catch(err => {
                console.warn('[version-check] fetch to /api/version failed:', err.message);
            });
    }

    function renderUpdateToast() {
        if (document.getElementById('updateToast')) return;
        if (!document.body) {
            console.warn('[version-check] document.body not available yet — retrying shortly.');
            setTimeout(renderUpdateToast, 200);
            return;
        }

        const toast = document.createElement('div');
        toast.id = 'updateToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 999999;
            background: rgba(18, 21, 30, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #e7e9ee;
            font-family: 'IBM Plex Mono', monospace, sans-serif;
            font-size: 11.5px;
            font-weight: 600;
            letter-spacing: .02em;
            padding: 9px 14px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.12);
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            pointer-events: none;
            opacity: 0;
            transform: translateY(8px);
            transition: opacity .2s ease, transform .2s ease;
        `;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        let secondsLeft = 3;
        toast.textContent = `⟳ Update available — refreshing in ${secondsLeft}s`;

        const countdown = setInterval(() => {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                clearInterval(countdown);
                toast.textContent = `⟳ Refreshing…`;
                window.location.reload();
            } else {
                toast.textContent = `⟳ Update available — refreshing in ${secondsLeft}s`;
            }
        }, 1000);
    }

    pollTimer = setInterval(checkServerVersion, 3000);
    checkServerVersion(); // also check immediately on load, don't wait 3s for the first one
})();