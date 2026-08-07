(function () {
    const clientVersion = window.APP_BUILD_VERSION;
    if (!clientVersion) return;

    let isOutdated = false;
    let countdownInterval = null;

    function checkServerVersion() {
        fetch('/api/version')
            .then(res => res.json())
            .then(data => {
                if (data && data.version && data.version !== clientVersion && !isOutdated) {
                    isOutdated = true;
                    renderOutdatedBanner();
                }
            })
            .catch(() => {});
    }

    function renderOutdatedBanner() {
        if (document.getElementById('outdatedBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'outdatedBanner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: #e05a3a;
            color: #ffffff;
            font-family: 'IBM Plex Mono', monospace, sans-serif;
            font-size: 13px;
            font-weight: 700;
            text-align: center;
            padding: 10px 16px;
            cursor: pointer;
            user-select: none;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            transition: background 0.2s ease;
        `;
        banner.innerHTML = `⚠️ Website version is outdated! Double-click here to start a 10s force refresh.`;

        banner.addEventListener('dblclick', startForceRestartCountdown);
        document.body.prepend(banner);
    }

    function startForceRestartCountdown() {
        const banner = document.getElementById('outdatedBanner');
        if (!banner || countdownInterval) return;

        let secondsLeft = 10;
        banner.style.background = '#d97706';
        banner.innerHTML = `🔄 Outdated website! Force restarting in <b>${secondsLeft}s</b>...`;

        countdownInterval = setInterval(() => {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                clearInterval(countdownInterval);
                banner.style.background = '#22c55e';
                banner.innerHTML = `🚀 Refreshing now...`;
                window.location.reload(true);
            } else {
                banner.innerHTML = `🔄 Outdated website! Force restarting in <b>${secondsLeft}s</b>...`;
            }
        }, 1000);
    }

    // Poll every 3 seconds for instant detection
    setInterval(checkServerVersion, 3000);
})();