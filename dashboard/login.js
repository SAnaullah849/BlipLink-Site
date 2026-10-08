(() => {
    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            showSetupNotice('Sign-in is temporarily unavailable. Please try again later.');
            byId('loginButton').disabled = true;
            return;
        }

        const supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        });

        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            showLoginError('Unable to check your sign-in. Please try again.');
            console.error('Session check failed:', error.message);
            byId('loginForm').addEventListener('submit', event => signIn(event, supabaseClient));
            return;
        }

        if (data.session?.user) {
            goToDashboard();
            return;
        }

        byId('loginForm').addEventListener('submit', event => signIn(event, supabaseClient));
    }

    async function signIn(event, supabaseClient) {
        event.preventDefault();
        const button = byId('loginButton');
        button.disabled = true;
        button.textContent = 'Signing in…';
        showLoginError('');

        const email = byId('loginEmail').value.trim();
        const password = byId('loginPassword').value;
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                showLoginError('Sign-in failed. Check your email and password, then try again.');
                console.error('Company sign-in failed:', error.message);
                return;
            }

            if (!data.session) {
                showLoginError('Sign-in succeeded, but no session was returned. Please try again.');
                return;
            }

            goToDashboard();
        } catch (error) {
            showLoginError('Sign-in is unavailable right now. Please check your connection and try again.');
            console.error('Company sign-in request failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Sign in';
        }
    }

    function goToDashboard() {
        window.location.assign(new URL('dashboard/index.html', window.location.href).href);
    }

    function showSetupNotice(message) {
        const notice = byId('setupNotice');
        notice.hidden = false;
        notice.textContent = message;
    }

    function showLoginError(message) {
        byId('loginMessage').textContent = message;
    }
})();
