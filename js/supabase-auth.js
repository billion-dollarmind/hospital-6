/**
 * Kairon Supabase auth — email/password, admin approval for new users
 */
(function () {
    const MATCHES_SESSION_CODE = '42055578';
    const RESTRICTED_DAILY_MS = 60 * 60 * 1000;
    const RESTRICTED_COOLDOWN_MS = 12 * 60 * 60 * 1000;

    let supabase = null;
    let currentUserRole = null;
    let currentProfile = null;
    let matchesAccessGranted = false;
    let restrictedTimerInterval = null;

    window.currentUserRole = null;

    function syncRole() {
        window.currentUserRole = currentUserRole;
    }

    function getConfig() {
        return window.KAIRON_CONFIG || {};
    }

    function getConfigError() {
        const cfg = getConfig();
        if (!window.KAIRON_CONFIG) {
            return 'config.js did not load. On your live site, upload config.js to the server (it was missing — 404).';
        }
        if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_PROJECT')) {
            return 'Set SUPABASE_URL in config.js (Project Settings → API → Project URL).';
        }
        if (!cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')) {
            return 'Set SUPABASE_ANON_KEY in config.js (Project Settings → API → publishable or anon public key).';
        }
        if (!window.supabase?.createClient) {
            return 'Supabase library failed to load. Check your internet connection and refresh.';
        }
        return null;
    }

    function initClient() {
        const err = getConfigError();
        if (err) return { error: err };
        const cfg = getConfig();
        try {
            return { client: window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) };
        } catch (e) {
            return { error: e.message || 'Could not connect to Supabase.' };
        }
    }

    function clearRestrictedSession() {
        localStorage.removeItem('restricted_login_time');
        localStorage.removeItem('restricted_cooldown_until');
    }

    function getRestrictedCooldownRemaining() {
        const cooldown = localStorage.getItem('restricted_cooldown_until');
        if (cooldown && Date.now() < parseInt(cooldown, 10)) return parseInt(cooldown, 10) - Date.now();
        if (cooldown && Date.now() >= parseInt(cooldown, 10)) localStorage.removeItem('restricted_cooldown_until');
        return null;
    }

    function isRestrictedSessionValid() {
        if (currentUserRole !== 'restricted') return true;
        const cooldownRemaining = getRestrictedCooldownRemaining();
        if (cooldownRemaining !== null && cooldownRemaining > 0) return false;
        const loginTime = localStorage.getItem('restricted_login_time');
        if (!loginTime) return false;
        const elapsed = Date.now() - parseInt(loginTime, 10);
        if (elapsed > RESTRICTED_DAILY_MS) {
            localStorage.setItem('restricted_cooldown_until', String(Date.now() + RESTRICTED_COOLDOWN_MS));
            localStorage.removeItem('restricted_login_time');
            return false;
        }
        return true;
    }

    function startRestrictedSession() {
        localStorage.setItem('restricted_login_time', String(Date.now()));
        localStorage.removeItem('restricted_cooldown_until');
        updateRestrictedTimerDisplay();
        if (restrictedTimerInterval) clearInterval(restrictedTimerInterval);
        restrictedTimerInterval = setInterval(() => {
            if (currentUserRole === 'restricted') {
                if (!isRestrictedSessionValid()) {
                    clearInterval(restrictedTimerInterval);
                    alert('Your 1-hour daily session has ended. Entering cooling mode for 12 hours.');
                    logoutAndClear();
                } else {
                    updateRestrictedTimerDisplay();
                }
            }
        }, 60000);
    }

    function updateRestrictedTimerDisplay() {
        const timerDiv = document.getElementById('restrictedTimerDisplay');
        if (currentUserRole === 'restricted' && timerDiv) {
            const loginTime = localStorage.getItem('restricted_login_time');
            if (loginTime) {
                const elapsed = Date.now() - parseInt(loginTime, 10);
                const remainingMs = Math.max(0, RESTRICTED_DAILY_MS - elapsed);
                const minutesLeft = Math.floor(remainingMs / 60000);
                timerDiv.classList.remove('hidden');
                timerDiv.innerHTML = `<i class="fas fa-hourglass-half mr-1"></i>Session remaining: ${minutesLeft} min`;
            } else {
                timerDiv.classList.add('hidden');
            }
        } else if (timerDiv) {
            timerDiv.classList.add('hidden');
        }
    }

    function updateHeaderAuthUI() {
        const adminBtn = document.getElementById('adminUsersBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userLabel = document.getElementById('userEmailLabel');
        if (adminBtn) adminBtn.classList.toggle('hidden', currentUserRole !== 'admin');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (userLabel && currentProfile?.email) {
            userLabel.textContent = currentProfile.email.split('@')[0];
            userLabel.classList.remove('hidden');
        }
    }

    function launchApp() {
        updateHeaderAuthUI();
        if (currentUserRole === 'restricted') startRestrictedSession();
        setTimeout(() => {
            document.getElementById('loader').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loader').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                if (typeof startTradingApp === 'function') startTradingApp();
            }, 500);
        }, 1500);
    }

    async function fetchProfile(userId) {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (error) throw error;
        return data;
    }

    function applyProfile(profile) {
        currentProfile = profile;
        currentUserRole = profile.role === 'admin' ? 'admin' : 'restricted';
        matchesAccessGranted = sessionStorage.getItem('matches_code_granted') === 'true';
        syncRole();
    }

    async function enterApprovedUser(profile) {
        applyProfile(profile);
        if (currentUserRole === 'restricted' && !isRestrictedSessionValid()) {
            const cooldownRemaining = getRestrictedCooldownRemaining();
            if (cooldownRemaining) {
                showCooldownModal();
                return false;
            }
        }
        launchApp();
        return true;
    }

    function showCooldownModal() {
        const cooldownUntil = localStorage.getItem('restricted_cooldown_until');
        let remainingHours = 12;
        if (cooldownUntil) {
            remainingHours = Math.ceil((parseInt(cooldownUntil, 10) - Date.now()) / (1000 * 60 * 60));
        }
        const overlay = document.createElement('div');
        overlay.className = 'cooldown-overlay';
        overlay.innerHTML = `<div class="lock-modal"><h2><i class="fas fa-hourglass-half"></i> COOLING MODE</h2><div class="lock-warning"><i class="fas fa-clock mr-2"></i> Your 1-hour daily access has expired. System is cooling for ${remainingHours} more hours.</div><button id="cooldownOkBtn">OK</button></div>`;
        document.body.appendChild(overlay);
        document.getElementById('cooldownOkBtn').onclick = () => { overlay.remove(); logoutAndClear(); };
    }

    function showConfigError(message) {
        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.innerHTML = `<div class="login-modal"><h2><i class="fas fa-cog"></i> Setup Required</h2><p class="text-sm text-red-400 mb-3">${message}</p><p class="text-sm text-gray-400 mb-4">Also run <code>supabase/schema.sql</code> once in the Supabase SQL editor if you have not already.</p></div>`;
        document.body.appendChild(overlay);
    }

    function showLoginModal() {
        if (document.querySelector('.login-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.innerHTML = `
            <div class="login-modal auth-modal">
                <h2><i class="fas fa-shield-alt"></i> KAIRON SECURE ACCESS</h2>
                <div class="auth-tabs">
                    <button type="button" class="auth-tab active" data-tab="login">Sign In</button>
                    <button type="button" class="auth-tab" data-tab="register">Register</button>
                </div>
                <div id="authLoginPanel">
                    <input type="email" id="loginEmail" placeholder="Email Address" autocomplete="email">
                    <input type="password" id="loginPassword" placeholder="Password" autocomplete="current-password">
                    <button type="button" id="loginBtn">SIGN IN</button>
                </div>
                <div id="authRegisterPanel" class="hidden">
                    <input type="email" id="registerEmail" placeholder="Email Address" autocomplete="email">
                    <input type="password" id="registerPassword" placeholder="Password (min 6 characters)" autocomplete="new-password">
                    <p class="text-[10px] text-gray-500 mb-2">New accounts require admin approval before access.</p>
                    <button type="button" id="registerBtn">CREATE ACCOUNT</button>
                </div>
                <div id="loginError" class="error-message"></div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const isLogin = tab.dataset.tab === 'login';
                document.getElementById('authLoginPanel').classList.toggle('hidden', !isLogin);
                document.getElementById('authRegisterPanel').classList.toggle('hidden', isLogin);
                document.getElementById('loginError').textContent = '';
            });
        });

        document.getElementById('loginBtn').addEventListener('click', () => handleLogin(overlay));
        document.getElementById('registerBtn').addEventListener('click', () => handleRegister(overlay));
    }

    async function handleLogin(overlay) {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }

        const btn = document.getElementById('loginBtn');
        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            const profile = await fetchProfile(data.user.id);
            if (profile.status === 'pending') {
                await supabase.auth.signOut();
                errEl.textContent = 'Your account is awaiting admin approval.';
                return;
            }
            if (profile.status === 'rejected') {
                await supabase.auth.signOut();
                errEl.textContent = 'Your account was not approved. Contact admin.';
                return;
            }
            overlay.remove();
            await enterApprovedUser(profile);
        } catch (e) {
            errEl.textContent = e.message || 'Sign in failed.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'SIGN IN';
        }
    }

    async function handleRegister(overlay) {
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }
        if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

        const btn = document.getElementById('registerBtn');
        btn.disabled = true;
        btn.textContent = 'Creating account...';

        try {
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
            await supabase.auth.signOut();
            document.querySelector('.auth-tab[data-tab="login"]')?.click();
            errEl.innerHTML = '<span class="text-green-400"><i class="fas fa-check-circle"></i> Account created! Wait for admin approval, then sign in.</span>';
        } catch (e) {
            errEl.textContent = e.message || 'Registration failed.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'CREATE ACCOUNT';
        }
    }

    async function showAdminPanel() {
        const { data: pending, error } = await supabase
            .from('profiles')
            .select('id, email, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) { alert(error.message); return; }

        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.id = 'adminPanelOverlay';
        const listHtml = pending?.length
            ? pending.map(u => `
                <div class="admin-user-row" data-id="${u.id}">
                    <div><p class="text-sm font-semibold">${u.email}</p><p class="text-[10px] text-gray-500">Requested ${new Date(u.created_at).toLocaleString()}</p></div>
                    <div class="flex gap-2">
                        <button type="button" class="approve-btn px-2 py-1 bg-green-600 rounded text-xs">Approve</button>
                        <button type="button" class="reject-btn px-2 py-1 bg-red-600 rounded text-xs">Reject</button>
                    </div>
                </div>`).join('')
            : '<p class="text-center text-gray-500 text-sm py-4">No pending users</p>';

        overlay.innerHTML = `
            <div class="login-modal admin-modal">
                <h2><i class="fas fa-users-cog"></i> Approve Users</h2>
                <div class="admin-user-list">${listHtml}</div>
                <button type="button" id="closeAdminPanel" class="mt-3">Close</button>
            </div>`;
        document.body.appendChild(overlay);

        document.getElementById('closeAdminPanel').onclick = () => overlay.remove();
        overlay.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.closest('.admin-user-row').dataset.id;
                btn.disabled = true;
                const { error: err } = await supabase.rpc('approve_user', { target_user_id: id });
                if (err) alert(err.message);
                else { overlay.remove(); showAdminPanel(); }
            });
        });
        overlay.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.closest('.admin-user-row').dataset.id;
                if (!confirm('Reject this user?')) return;
                btn.disabled = true;
                const { error: err } = await supabase.rpc('reject_user', { target_user_id: id });
                if (err) alert(err.message);
                else { overlay.remove(); showAdminPanel(); }
            });
        });
    }

    async function logoutAndClear() {
        if (supabase) await supabase.auth.signOut();
        currentUserRole = null;
        currentProfile = null;
        matchesAccessGranted = false;
        clearRestrictedSession();
        sessionStorage.removeItem('matches_code_granted');
        if (restrictedTimerInterval) clearInterval(restrictedTimerInterval);
        syncRole();
        window.location.reload();
    }

    function checkMatchesAccess() {
        if (currentUserRole === 'admin') return true;
        if (currentUserRole === 'restricted') {
            if (matchesAccessGranted) return true;
            const code = prompt('Enter session code to access MATCHES/DIFFERS analysis:');
            if (code === MATCHES_SESSION_CODE) {
                matchesAccessGranted = true;
                sessionStorage.setItem('matches_code_granted', 'true');
                return true;
            }
            alert('Invalid session code. Access denied.');
            return false;
        }
        return false;
    }

    async function initAuth() {
        document.getElementById('adminUsersBtn')?.addEventListener('click', showAdminPanel);
        document.getElementById('logoutBtn')?.addEventListener('click', logoutAndClear);

        supabase = initClient();
        if (supabase.error || !supabase.client) {
            showConfigError(supabase.error || 'Supabase configuration error.');
            return;
        }
        supabase = supabase.client;

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            try {
                const profile = await fetchProfile(session.user.id);
                if (profile.status === 'approved') {
                    await enterApprovedUser(profile);
                    return;
                }
                await supabase.auth.signOut();
            } catch (e) {
                console.error(e);
                await supabase.auth.signOut();
            }
        }
        showLoginModal();
    }

    window.KaironAuth = {
        init: initAuth,
        logout: logoutAndClear,
        checkMatchesAccess,
        updateRestrictedTimerDisplay,
        isRestrictedSessionValid,
        get currentUserRole() { return currentUserRole; }
    };
    window.checkMatchesAccess = checkMatchesAccess;
    window.logoutAndClear = logoutAndClear;
    window.updateRestrictedTimerDisplay = updateRestrictedTimerDisplay;
    window.isRestrictedSessionValid = isRestrictedSessionValid;
})();
