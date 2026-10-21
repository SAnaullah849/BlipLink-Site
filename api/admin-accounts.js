const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function adminAccounts(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST, PATCH');
        return res.status(405).json({ error: 'Method not allowed.' });
    }
    if (req.method !== 'GET') {
        try {
            if (new URL(req.headers.origin).host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) {
                return res.status(403).json({ error: 'Same-origin requests are required.' });
            }
        } catch {
            return res.status(403).json({ error: 'Same-origin requests are required.' });
        }
    }
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) {
        return res.status(401).json({ error: 'Please sign in to your administrator account.' });
    }
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) {
        return res.status(503).json({ error: 'Account administration is not configured on the server.' });
    }
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
    async function request(route, options = {}) {
        const response = await fetch(`${baseUrl}${route}`, {
            ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000),
        });
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        return { ok: response.ok, status: response.status, data };
    }
    try {
        // Verify the token with Auth; never trust a decoded JWT or browser metadata.
        const user = await request('/auth/v1/user', { headers: { Authorization: authorization } });
        if (!user.ok) {
            return res.status(user.status >= 500 ? 502 : 401).json({ error: 'Unable to verify your sign-in. Please sign in again.' });
        }
        if (!UUID_PATTERN.test(user.data?.id || '')) {
            return res.status(401).json({ error: 'Invalid sign-in session.' });
        }
        const membership = await request(`/rest/v1/app_admins?user_id=eq.${user.data.id}&select=user_id`);
        if (!membership.ok) {
            return res.status(503).json({ error: 'Run dashboard/account-access.sql in Supabase to configure account administration.' });
        }
        if (!Array.isArray(membership.data) || !membership.data.some(row => row.user_id === user.data.id)) {
            return res.status(403).json({ error: 'Administrator access is required.' });
        }
        if (req.method === 'GET') {
            const page = req.query?.page === undefined ? 1 : Number(req.query.page);
            if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
                return res.status(400).json({ error: 'Invalid page number.' });
            }
            const accounts = await request('/rest/v1/rpc/list_bliplink_accounts', {
                method: 'POST', body: JSON.stringify({ requested_page: page }),
            });
            if (!accounts.ok || !Array.isArray(accounts.data)) {
                return res.status(502).json({ error: 'Unable to list accounts. Check the account-access database setup.' });
            }
            return res.status(200).json({ accounts: accounts.data, page, pageSize: 50 });
        }
        const body = req.body;
        if (req.method === 'PATCH' && body?.action === 'administrator') {
            if (typeof body.userId !== 'string' || !UUID_PATTERN.test(body.userId) || typeof body.isAdmin !== 'boolean') {
                return res.status(400).json({ error: 'Choose an existing account and administrator access setting.' });
            }
            const result = await request('/rest/v1/rpc/set_bliplink_administrator', {
                method: 'POST', body: JSON.stringify({ requested_user_id: body.userId, requested_admin: body.isAdmin }),
            });
            if (!result.ok) {
                const lastAdmin = result.data?.message?.includes('last administrator');
                return res.status(lastAdmin ? 409 : 502).json({ error: lastAdmin
                    ? 'The last administrator cannot be removed. Add another administrator first.' : 'Unable to update administrator access.' });
            }
            return res.status(200).json({ userId: body.userId, isAdmin: body.isAdmin });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || !['individual', 'company'].includes(body.accountType)) {
            return res.status(400).json({ error: 'Choose an individual or company account.' });
        }
        const profileLimit = body.accountType === 'individual' ? 1 : body.profileLimit;
        if (!Number.isSafeInteger(profileLimit) || profileLimit < 1 || profileLimit > 100000) {
            return res.status(400).json({ error: 'Company profile allowance must be a whole number between 1 and 100,000.' });
        }
        let userId;
        if (req.method === 'POST') {
            const email = typeof body.email === 'string' ? body.email.trim() : '';
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Enter a valid email address.' });
            }
            const invitation = await request('/auth/v1/invite', {
                method: 'POST', body: JSON.stringify({ email }),
            });
            if (!invitation.ok || !UUID_PATTERN.test(invitation.data?.id || '')) {
                return res.status(invitation.status >= 500 ? 502 : 400).json({
                    error: 'Unable to invite this user. Check whether the account already exists and whether Supabase email delivery is available.',
                });
            }
            userId = invitation.data.id;
        } else {
            userId = body.userId;
            if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
                return res.status(400).json({ error: 'Choose a valid account.' });
            }
        }
        const update = await request(`/rest/v1/account_access?user_id=eq.${userId}`, {
            method: 'PATCH', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ account_type: body.accountType, profile_limit: profileLimit }),
        });
        if (!update.ok || !Array.isArray(update.data) || update.data.length !== 1) {
            if (req.method === 'POST') {
                return res.status(502).json({ error: 'The invitation was sent, but the account allowance was not saved. Refresh the account list and edit this user before sending another invitation.', invitationSent: true });
            }
            const conflict = update.data?.message?.includes('Remove extra profiles');
            return res.status(conflict ? 409 : 502).json({ error: conflict
                ? 'This account has more profiles than the requested allowance. Remove extra profiles before reducing the limit or switching to individual.'
                : 'Unable to update this account. Refresh the list and try again.' });
        }
        return res.status(req.method === 'POST' ? 201 : 200).json({ account: update.data[0] });
    } catch {
        return res.status(502).json({ error: 'Account administration is temporarily unavailable. Refresh the list before retrying an invitation.' });
    }
};
