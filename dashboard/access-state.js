(function (root) {
    function normalize(value) {
        const row = Array.isArray(value) ? value[0] : value;
        if (!row || !['individual', 'company'].includes(row.account_type)) return null;
        return {
            ...row, configured: row.configured !== false,
            can_edit: row.can_edit === true && row.effective_status === 'active' && row.configured !== false,
            effective_status: ['active', 'inactive', 'scheduled', 'expired'].includes(row.effective_status) ? row.effective_status : 'unavailable',
            access_period: row.access_period === 'monthly' ? 'monthly' : 'yearly',
        };
    }
    async function load(client) {
        try {
            const result = await client.rpc('get_my_account_access');
            if (!result.error) {
                const access = normalize(result.data);
                if (access) return access;
            }
        } catch { /* A missing setup or a network failure must not grant access. */ }
        const session = await client.auth.getSession();
        const userId = session.data?.session?.user?.id;
        if (!userId) throw new Error('Please sign in again.');
        const legacy = await client.from('account_access').select('account_type, profile_limit').eq('user_id', userId).single();
        const access = normalize({ ...legacy.data, configured: false, can_edit: false });
        if (legacy.error || !access) throw new Error('Account access is unavailable. Contact support.');
        return access;
    }
    function date(value) {
        const parsed = new Date(value);
        return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed) : '—';
    }
    function label(access) { return access?.access_period === 'monthly' ? 'Monthly access' : 'Yearly access'; }
    function message(access) {
        if (!access?.configured) return 'Account setup is incomplete or unavailable. Editing is paused. Contact support.';
        if (access.effective_status === 'active') return `${label(access)} · available until ${date(access.expires_at)}.`;
        if (access.effective_status === 'scheduled') return `${label(access)} starts ${date(access.starts_at)}. Editing is paused and your public cards are hidden until then.`;
        if (access.effective_status === 'expired') return `${label(access)} expired ${date(access.expires_at)}. Editing is paused and your public cards are hidden. Contact support to renew.`;
        return 'Your account access is inactive. Editing is paused and your public cards are hidden. Contact support to activate it.';
    }
    function watch(client, callback) {
        let busy = false;
        const timer = root.setInterval(async () => {
            if (busy) return;
            busy = true;
            try { callback(await load(client)); } catch { callback(null); }
            finally { busy = false; }
        }, 60000);
        root.addEventListener('pagehide', () => root.clearInterval(timer), { once: true });
        return () => root.clearInterval(timer);
    }
    const api = { normalize, load, date, label, message, watch };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BlipLinkAccess = api;
})(typeof window === 'undefined' ? globalThis : window);
