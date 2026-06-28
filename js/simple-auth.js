(function () {
    const SITE_PASSWORD = '5059';
    const SESSION_KEY = 'kairon_authenticated';

    window.currentUserRole = 'admin';

    function isAuthenticated() {
        return sessionStorage.getItem(SESSION_KEY) === 'true';
    }

    function launchApp() {
        document.getElementById('logoutBtn')?.classList.remove('hidden');
        setTimeout(() => {
            document.getElementById('loader').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loader').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                if (typeof startTradingApp === 'function') startTradingApp();
            }, 500);
        }, 1500);
    }

    function showLoginModal() {
        if (document.querySelector('.login-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.innerHTML = `
            <div class="login-modal">
                <h2><i class="fas fa-shield-alt"></i> KAIRON ACCESS</h2>
                <input type="password" id="sitePassword" placeholder="Enter password" autocomplete="current-password">
                <button type="button" id="siteLoginBtn">ENTER</button>
                <div id="loginError" class="error-message"></div>
            </div>`;
        document.body.appendChild(overlay);

        const submit = () => {
            const pass = document.getElementById('sitePassword').value;
            const errEl = document.getElementById('loginError');
            if (pass === SITE_PASSWORD) {
                sessionStorage.setItem(SESSION_KEY, 'true');
                overlay.remove();
                launchApp();
            } else {
                errEl.textContent = 'Incorrect password.';
            }
        };

        document.getElementById('siteLoginBtn').addEventListener('click', submit);
        document.getElementById('sitePassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
    }

    function logoutAndClear() {
        sessionStorage.removeItem(SESSION_KEY);
        window.location.reload();
    }

    function initAuth() {
        document.getElementById('logoutBtn')?.addEventListener('click', logoutAndClear);
        if (isAuthenticated()) launchApp();
        else showLoginModal();
    }

    window.checkMatchesAccess = () => true;
    window.logoutAndClear = logoutAndClear;
    window.isRestrictedSessionValid = () => true;
    window.updateRestrictedTimerDisplay = () => {};

    window.KaironAuth = { init: initAuth, logout: logoutAndClear };
})();
