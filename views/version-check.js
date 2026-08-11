(function () {
    const clientVersion = window.APP_BUILD_VERSION;
    if (!clientVersion) return;

    let isOutdated = false;
    let pollTimer = null;

    function checkServerVersion() {
        fetch('/api/version')
            .then(res => res.json())
            .then(data => {
                if (data && data.version && data.version !== clientVersion && !isOutdated) {
                    isOutdated = true;
                    if (pollTimer) clearInterval(pollTimer);
                    renderUpdateToast();
                }
            })
            .catch(() => {});
    }

    function renderUpdateToast() {
        if (document.getElementById('updateToast')) return;

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

        // Fade/slide in on next frame so the transition actually plays.
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
                // Plain reload() is the correct modern call — the old
                // reload(true) "force" argument was a non-standard Firefox
                // extension that's deprecated and ignored everywhere else;
                // it never actually did anything extra in most browsers.
                window.location.reload();
            } else {
                toast.textContent = `⟳ Update available — refreshing in ${secondsLeft}s`;
            }
        }, 1000);
    }

    // Poll every 3 seconds for fast detection.
    pollTimer = setInterval(checkServerVersion, 3000);
})();