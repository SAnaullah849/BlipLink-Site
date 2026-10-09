const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function trackEvent(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    const host = String(req.headers.host || '').toLowerCase();
    const origin = req.headers.origin;
    if (!host || !origin) {
        return res.status(403).json({ error: 'Same-origin requests are required.' });
    }
    try {
        if (new URL(origin).host.toLowerCase() !== host) {
            return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
        }
    } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
    }

    const profileId = req.body && req.body.profileId;
    const eventType = req.body && req.body.eventType;
    if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId) || !['view', 'tap'].includes(eventType)) {
        return res.status(400).json({ error: 'Invalid analytics event.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(503).json({ error: 'Analytics service is not configured.' });
    }

    const countryHeader = String(
        req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || ''
    ).toUpperCase();
    const countryCode = /^[A-Z]{2}$/.test(countryHeader) && countryHeader !== 'XX'
        ? countryHeader
        : null;

    try {
        const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_public_card_event`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requested_profile_id: profileId,
                requested_event_type: eventType,
                requested_country_code: countryCode,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            console.error('Supabase analytics RPC failed:', response.status, error);
            return res.status(502).json({ error: 'Analytics event could not be recorded.' });
        }
        return res.status(204).end();
    } catch (error) {
        console.error('Analytics request failed:', error);
        return res.status(502).json({ error: 'Analytics service is temporarily unavailable.' });
    }
};
