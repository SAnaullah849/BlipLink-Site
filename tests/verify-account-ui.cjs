const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.BLIPLINK_PLAYWRIGHT || 'playwright');
const root = process.cwd();
const output = process.env.BLIPLINK_QA_OUTPUT || path.join(os.tmpdir(), 'bliplink-admin-qa');

function mockSupabase({ type = 'company', limit = 3, status = 'active', period = 'yearly' } = {}) {
    const user = { id: '11111111-1111-4111-8111-111111111111', email: 'devops@shaunco.ai' };
    const profiles = [JSON.parse(localStorage.getItem('qa-profile') || 'null') || { id: '22222222-2222-4222-8222-222222222222', user_id: user.id, full_name: 'Alex Morgan', contact_email: 'alex@example.com', company_name: 'BlipLink', card_theme: {}, custom_links: [], created_at: new Date().toISOString() }];
    window.__qaRequests = [];
    const accessState = () => {
        const effective = localStorage.getItem('qa-access-status') || status;
        return { account_type: type, profile_limit: limit, access_period: period, access_status: effective === 'inactive' ? 'inactive' : 'active',
            effective_status: effective, can_edit: effective === 'active', starts_at: '2020-01-01',
            expires_at: effective === 'expired' ? '2021-01-01' : new Date(Date.now() + 86400000 * 100).toISOString() };
    };
    const client = {
        auth: { getSession: async () => ({ data: { session: { user, access_token: 'fake-test-token' } }, error: null }), onAuthStateChange() {} },
        from(table) {
            window.__qaRequests.push(table);
            let insertion;
            const result = single => {
                let data = table === 'account_access' ? { account_type: type, profile_limit: limit }
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
                update(value) { Object.assign(profiles[0], value); localStorage.setItem('qa-profile', JSON.stringify(profiles[0])); return this; },
                single: async () => result(true), maybeSingle: async () => result(true),
                then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
            };
            return query;
        },
        rpc: async name => {
            window.__qaRequests.push(name);
            return { data: name === 'get_my_account_access' ? [accessState()]
                : name === 'get_public_company_card' ? (accessState().can_edit ? [{ ...profiles[0], profile_id: profiles[0].id }] : [])
                : name === 'get_public_card_appearance' ? { theme: profiles[0].card_theme, account_type: type, expires_at: accessState().expires_at } : [], error: null };
        },
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
        const removedContext = await browser.newContext();
        assert.equal((await removedContext.request.get(base + '/dashboard/admin.html')).status(), 404);
        assert.equal((await removedContext.request.get(base + '/api/admin-accounts')).status(), 404);
        await removedContext.close();
        for (const type of ['individual', 'company']) {
            const userContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
            await userContext.addInitScript(mockSupabase, { type, limit: type === 'individual' ? 1 : 3, admin: false });
            await userContext.route('https://**/*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
            await userContext.route('**/api/track-event', route => route.fulfill({ status: 204 }));
            const userPage = await userContext.newPage();
            userPage.on('pageerror', error => errors.push(error.message));
            await userPage.goto(base + '/dashboard/profile.html');
            if (type === 'individual') {
                await userPage.waitForURL('**/dashboard/personal.html');
                await userPage.locator('#personalWorkspace').waitFor({ state: 'visible' });
                assert.equal(await userPage.getByRole('button', { name: 'Add profile' }).count(), 0);
                assert.equal(await userPage.getByRole('link', { name: 'CRM', exact: true }).count(), 0);
                assert.equal(await userPage.getByRole('link', { name: 'Company', exact: true }).count(), 0);
                const requests = await userPage.evaluate(() => window.__qaRequests);
                assert.equal(requests.some(name => name === 'crm_leads' || name.includes('analytics') || name === 'card_contact_exchanges'), false);
                for (const route of ['index', 'social', 'company', 'leads', 'crm', 'subscription', 'help']) {
                    await userPage.goto(base + `/dashboard/${route}.html`);
                    await userPage.waitForURL('**/dashboard/personal.html');
                    await userPage.locator('#personalWorkspace').waitFor({ state: 'visible' });
                }
                await userPage.locator('input[name="full_name"]').fill('');
                await userPage.getByRole('tab', { name: 'Design', exact: true }).click();
                await userPage.locator('#savePersonalCard').click();
                assert.equal(await userPage.locator('#detailsTab').getAttribute('aria-selected'), 'true');
                await userPage.locator('input[name="full_name"]').fill('Alex Rivera');
                await userPage.getByRole('tab', { name: 'Design', exact: true }).click();
                await userPage.locator('[data-preset="rose"]').click();
                await userPage.locator('input[name="theme_accentColor"]').fill('#6d28d9');
                await userPage.locator('select[name="theme_layout"]').selectOption('left');
                await userPage.locator('input[name="theme_showQr"]').uncheck();
                const preview = userPage.frameLocator('#personalPreviewFrame');
                await preview.locator('#publicName').filter({ hasText: 'Alex Rivera' }).waitFor();
                assert.equal(await preview.locator('.card-qr-section').isVisible(), false);
                assert.equal(await preview.locator('#publicCard').evaluate(el => el.style.getPropertyValue('--card-accent')), '#6d28d9');
                await userPage.locator('#savePersonalCard').click();
                await userPage.locator('#personalSaveState').filter({ hasText: 'All changes saved' }).waitFor();
                await userPage.reload();
                await userPage.locator('#personalWorkspace').waitFor({ state: 'visible' });
                await userPage.getByRole('tab', { name: 'Design', exact: true }).click();
                assert.equal(await userPage.locator('input[name="theme_accentColor"]').inputValue(), '#6d28d9');
                assert.equal(await userPage.locator('input[name="theme_showQr"]').isChecked(), false);
                await userPage.screenshot({ path: path.join(output, 'personal-desktop.png'), fullPage: true });
                await userPage.setViewportSize({ width: 390, height: 844 });
                assert.equal(await userPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await userPage.screenshot({ path: path.join(output, 'personal-mobile.png'), fullPage: true });
                const publicPage = await userContext.newPage();
                publicPage.on('pageerror', error => errors.push(error.message));
                await publicPage.goto(base + '/card.html?id=22222222-2222-4222-8222-222222222222');
                await publicPage.locator('#publicCard').waitFor({ state: 'visible' });
                assert.equal(await publicPage.locator('#publicName').textContent(), 'Alex Rivera');
                assert.equal(await publicPage.locator('#publicCard').evaluate(el => el.style.getPropertyValue('--card-accent')), '#6d28d9');
                assert.equal(await publicPage.locator('#exchangeContactButton').isVisible(), false);
                assert.equal(await publicPage.locator('.card-qr-section').isVisible(), false);
                await publicPage.screenshot({ path: path.join(output, 'personal-public-card.png'), fullPage: true });
                await userContext.close();
                continue;
            }
            await userPage.locator('#accountAllowance').filter({ hasText: '1 of' }).waitFor();
            assert.equal(await userPage.locator('#addProfileButton').isDisabled(), type === 'individual');
            assert.equal(await userPage.locator('[data-nav="company"]').isVisible(), type === 'company');
            assert.equal(await userPage.locator('#adminNavigationLink').count(), 0);
            await userPage.goto(base + '/dashboard/social.html');
            await userPage.locator('#socialLinks').waitFor({ state: 'visible' });
            assert.equal(await userPage.locator('#dashboardView').isVisible(), true);
            await userPage.goto(base + '/dashboard/company.html');
            await userPage.locator('#accountAllowance').filter({ hasText: '1 of' }).waitFor();
            await userPage.locator(type === 'individual' ? '#profileEditor' : '#companyPage').waitFor({ state: 'visible' });
            await userContext.close();
        }
        for (const type of ['individual', 'company']) {
            const pausedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
            await pausedContext.addInitScript(mockSupabase, { type, status: 'expired', period: 'monthly' });
            await pausedContext.route('https://**/*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
            const pausedPage = await pausedContext.newPage();
            pausedPage.on('pageerror', error => errors.push(error.message));
            await pausedPage.goto(base + '/dashboard/index.html');
            if (type === 'individual') {
                await pausedPage.waitForURL('**/dashboard/personal.html');
                await pausedPage.locator('#personalWorkspace').waitFor({ state: 'visible' });
                assert.equal(await pausedPage.locator('#savePersonalCard').isDisabled(), true);
                assert.equal(await pausedPage.locator('#personalCardForm').evaluate(element => element.inert), true);
                assert.match(await pausedPage.locator('#personalAccessStatus').textContent(), /expired.*public cards are hidden/);
            } else {
                await pausedPage.locator('#subscription').waitFor({ state: 'visible' });
                assert.equal(await pausedPage.locator('#subscriptionPlan').textContent(), 'Monthly access');
                assert.equal(await pausedPage.locator('[data-nav="company"]').isVisible(), false);
                assert.equal(await pausedPage.locator('[data-nav="crm"]').isVisible(), false);
            }
            assert.equal(await pausedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await pausedPage.screenshot({ path: path.join(output, `${type}-expired-mobile.png`), fullPage: true });
            const expiredPublic = await pausedContext.newPage();
            await expiredPublic.goto(base + '/card.html?id=22222222-2222-4222-8222-222222222222');
            await expiredPublic.locator('#cardStatus').filter({ hasText: 'not available' }).waitFor();
            assert.equal(await expiredPublic.locator('#publicCard').isVisible(), false);
            await pausedPage.evaluate(() => localStorage.setItem('qa-access-status', 'active'));
            await pausedPage.reload();
            if (type === 'individual') {
                await pausedPage.locator('#personalWorkspace').waitFor({ state: 'visible' });
                assert.equal(await pausedPage.locator('#savePersonalCard').isEnabled(), true);
            } else {
                await pausedPage.locator('#accountAllowance').filter({ hasText: 'Monthly access' }).waitFor();
                await pausedPage.locator('#mobileNavigationToggle').click();
                await pausedPage.locator('[data-nav="crm"]').waitFor({ state: 'visible' });
            }
            await pausedContext.close();
        }
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: removed admin routes, individual route isolation, theme preview/save/reload/public card, desktop/mobile layouts, and company routes.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
