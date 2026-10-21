const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.BLIPLINK_PLAYWRIGHT || 'playwright');
const root = process.cwd();
const output = process.env.BLIPLINK_QA_OUTPUT || path.join(os.tmpdir(), 'bliplink-admin-qa');

function mockSupabase({ type = 'company', limit = 3, admin = true } = {}) {
    const user = { id: '11111111-1111-4111-8111-111111111111', email: 'devops@shaunco.ai' };
    const profiles = [{ id: '22222222-2222-4222-8222-222222222222', user_id: user.id, full_name: 'Alex Morgan', company_name: 'BlipLink', custom_links: [], created_at: new Date().toISOString() }];
    const client = {
        auth: { getSession: async () => ({ data: { session: { user, access_token: 'fake-test-token' } }, error: null }), onAuthStateChange() {} },
        from(table) {
            let insertion;
            const result = single => {
                let data = table === 'account_access' ? { account_type: type, profile_limit: limit }
                    : table === 'app_admins' ? (admin ? { user_id: user.id } : null)
                    : table === 'company_profiles' ? (single ? profiles[0] : profiles)
                    : table === 'company_subscriptions' ? null : [];
                if (insertion) {
                    const row = { ...insertion, id: '33333333-3333-4333-8333-333333333333', custom_links: [] };
                    profiles.push(row); data = row;
                }
                return { data, error: null };
            };
            const query = {
                select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
                insert(value) { insertion = value; return this; },
                single: async () => result(true), maybeSingle: async () => result(true),
                then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
            };
            return query;
        },
        rpc: async () => ({ data: [], error: null }),
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
    };
    window.supabase = { createClient: () => client };
}

(async () => {
    await fs.mkdir(output, { recursive: true });
    const server = http.createServer(async (req, res) => {
        const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        try {
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
            res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
            res.end(await fs.readFile(file));
        } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'msedge' });
        const errors = [];
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        await context.addInitScript(mockSupabase, {});
        await context.route('https://**/*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const accounts = [
            { user_id: '11111111-1111-4111-8111-111111111111', email: 'devops@shaunco.ai', account_type: 'company', profile_limit: 10, profiles_used: 3, total_count: 2, is_admin: true },
            { user_id: '22222222-2222-4222-8222-222222222222', email: 'alex@example.com', account_type: 'individual', profile_limit: 1, profiles_used: 1, total_count: 2, is_admin: false },
        ];
        const mutations = [];
        await page.route('**/api/admin-accounts?*', async route => {
            const request = route.request();
            if (request.method() === 'GET') return route.fulfill({ json: { accounts, page: 1, pageSize: 50 } });
            const body = request.postDataJSON(); mutations.push(body);
            return route.fulfill({ json: { account: { profile_limit: body.profileLimit }, isAdmin: body.isAdmin } });
        });
        await page.goto(base + '/dashboard/admin.html');
        await page.locator('#adminContent').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.admin-account').count(), 2);
        assert.equal(await page.locator('#inviteProfileLimit').isDisabled(), true);
        await page.locator('#inviteAccountType').selectOption('company');
        assert.equal(await page.locator('#inviteProfileLimit').isEnabled(), true);
        await page.locator('#inviteEmail').fill('new-company@example.com');
        await page.locator('#inviteProfileLimit').fill('12');
        await page.locator('#inviteUserButton').click();
        await page.locator('#inviteMessage').filter({ hasText: 'Invitation sent' }).waitFor();
        assert.deepEqual(mutations[0], { email: 'new-company@example.com', accountType: 'company', profileLimit: 12 });
        await page.locator('.admin-account').nth(1).locator('input[type="checkbox"]').check();
        await page.locator('.admin-account').nth(1).getByRole('button', { name: 'Save admin access' }).click();
        await page.locator('.admin-account').nth(1).getByText('Administrator access updated.').waitFor();
        assert.equal(mutations[1].isAdmin, true);
        await page.screenshot({ path: path.join(output, 'admin-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'admin-mobile.png'), fullPage: true });

        for (const type of ['individual', 'company']) {
            const userContext = await browser.newContext();
            await userContext.addInitScript(mockSupabase, { type, limit: type === 'individual' ? 1 : 3, admin: false });
            await userContext.route('https://**/*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
            const userPage = await userContext.newPage();
            userPage.on('pageerror', error => errors.push(error.message));
            await userPage.goto(base + '/dashboard/profile.html');
            await userPage.locator('#accountAllowance').filter({ hasText: '1 of' }).waitFor();
            assert.equal(await userPage.locator('#addProfileButton').isDisabled(), type === 'individual');
            assert.equal(await userPage.locator('[data-nav="company"]').isVisible(), type === 'company');
            assert.equal(await userPage.locator('#adminNavigationLink').isVisible(), false);
            await userPage.goto(base + '/dashboard/social.html');
            await userPage.locator('#socialLinks').waitFor({ state: 'visible' });
            assert.equal(await userPage.locator('#dashboardView').isVisible(), true);
            await userPage.goto(base + '/dashboard/company.html');
            await userPage.locator('#accountAllowance').filter({ hasText: '1 of' }).waitFor();
            await userPage.locator(type === 'individual' ? '#profileEditor' : '#companyPage').waitFor({ state: 'visible' });
            await userContext.close();
        }
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: admin invitation, admin transfer controls, desktop/mobile layout, both account types, Social and Company routes.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
