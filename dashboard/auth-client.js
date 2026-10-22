(() => {
    const preferenceKey = 'bliplink-remember-session';

    function shouldRemember() {
        return window.localStorage.getItem(preferenceKey) !== 'false';
    }

    function createClient(options = {}) {
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) return null;

        const remember = typeof options.remember === 'boolean' ? options.remember : shouldRemember();
        return window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
                storage: remember ? window.localStorage : window.sessionStorage,
            },
        });
    }

    async function setRemember(remember) {
        const previous = shouldRemember();
        if (previous !== remember) {
            const oldClient = createClient({ remember: previous });
            if (oldClient) {
                const { data } = await oldClient.auth.getSession();
                if (data.session) await oldClient.auth.signOut({ scope: 'local' });
            }
        }
        window.localStorage.setItem(preferenceKey, remember ? 'true' : 'false');
    }

    window.BlipLinkAuth = Object.freeze({ createClient, setRemember, shouldRemember });
})();
