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
    const profiles = [JSON.parse(localStorage.getItem('qa-profile') || 'null') || { id: '22222222-2222-4222-8222-222222222222', user_id: user.id, full_name: 'Alex Morgan', contact_email: 'alex@example.com', phone: '+15551234567', website_url: 'https://example.com/alex', address: 'Office 07, Third Floor, 42 Business Avenue, Riyadh', company_name: 'BlipLink', card_theme: {}, custom_links: [], created_at: new Date().toISOString() }];
    if (type === 'company') profiles.push(JSON.parse(localStorage.getItem('qa-second-profile') || 'null') || { id: '44444444-4444-4444-8444-444444444444', user_id: user.id, full_name: 'Jamie Chen', job_title: 'Designer', department: 'Design', contact_email: 'jamie@example.com', card_theme: {}, custom_links: [], created_at: '2020-01-01' });
    let brand = JSON.parse(localStorage.getItem('qa-brand') || 'null') || { user_id: user.id, name: 'Northstar Labs', contact_email: 'hello@northstar.example', phone: '+15550009999', bio: 'Built for better connections.', website_url: 'https://northstar.example', address: '42 Company Avenue', logo_path: `${user.id}/company/logo.png`, banner_path: `${user.id}/company/banner.png`, banner_position: 50, custom_links: [], card_theme: {} };
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
            let insertion, patch, saved = false;
            const filters = {};
            const result = single => {
                let data = table === 'account_access' ? { account_type: type, profile_limit: limit }
                    : table === 'company_profiles' ? profiles.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value))
                    : table === 'company_branding' ? brand
                    : table === 'company_subscriptions' ? null : [];
                if (insertion && !saved) {
                    if (table === 'company_branding') brand = data = { ...insertion };
                    else { const row = { ...insertion, id: '33333333-3333-4333-8333-333333333333', custom_links: [], card_theme: {}, created_at: new Date().toISOString() }; profiles.push(row); data = [row]; }
                    saved = true;
                }
                if (patch && !saved) {
                    if (table === 'company_branding') { Object.assign(brand, patch); data = brand; localStorage.setItem('qa-brand', JSON.stringify(brand)); }
                    else { data.forEach(row => Object.assign(row, patch)); localStorage.setItem('qa-profile', JSON.stringify(profiles[0])); localStorage.setItem('qa-second-profile', JSON.stringify(profiles[1])); }
                    saved = true;
                }
                if (single && Array.isArray(data)) data = data[0] || null;
                return { data, error: null };
            };
            const query = {
                select() { return this; }, eq(key,value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; }, not() { return this; },
                insert(value) { insertion = value; return this; },
                update(value) { patch = value; return this; },
                single: async () => result(true), maybeSingle: async () => result(true),
                then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
            };
            return query;
        },
        storage: { from() { return { getPublicUrl: path => ({ data: { publicUrl: '/qa-image.svg?path=' + encodeURIComponent(path) } }), upload: async () => ({ error: null }), remove: async () => ({ error: null }) }; } },
        rpc: async (name, args) => {
            window.__qaRequests.push(name);
            const profile = profiles.find(row => row.id === args?.requested_user_id || row.id === args?.requested_profile_id) || profiles[0];
            return { data: name === 'get_my_account_access' ? [accessState()]
                : name === 'get_public_company_card' ? (accessState().can_edit ? [{ ...profile, profile_id: profile.id, ...(type === 'company' ? { company_name: brand.name, website_url: brand.website_url, address: brand.address, banner_path: brand.banner_path } : {}) }] : [])
                : name === 'get_public_card_appearance' ? { theme: type === 'company' ? brand.card_theme : profile.card_theme, account_type: type, expires_at: accessState().expires_at, banner_position: brand.banner_position, company_links: type === 'company' ? brand.custom_links : [], personal_details: { department: profile.department, alternate_name: profile.alternate_name, booking_url: profile.booking_url, secondary_phone: profile.secondary_phone } } : [], error: null };
        },
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
    };
    window.supabase = { createClient: () => client };
}

(async () => {
    await fs.mkdir(output, { recursive: true });
    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/qa-image.svg')) { res.setHeader('Content-Type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><defs><linearGradient id="g"><stop stop-color="#153b65"/><stop offset="1" stop-color="#39b7b2"/></linearGradient></defs><rect width="900" height="300" fill="url(#g)"/><circle cx="700" cy="200" r="160" fill="#ffffff22"/></svg>'); return; }
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
            userPage.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
            await userPage.goto(base + '/dashboard/profile.html');
            if (type === 'individual') {
                await userPage.waitForURL('**/dashboard/personal.html');
                try { await userPage.locator('#personalWorkspace').waitFor({ state: 'visible' }); }
                catch (error) { console.error(await userPage.locator('#personalMessage').textContent()); throw error; }
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
                await userPage.locator('input[name="theme_showContacts"]').uncheck();
                await preview.locator('#publicActions').waitFor({ state: 'hidden' });
                assert.equal(await preview.locator('#publicAddress').isVisible(), true);
                await userPage.locator('input[name="theme_showContacts"]').check();
                await preview.locator('#publicActions').waitFor({ state: 'visible' });
                await userPage.locator('input[name="theme_showAddress"]').uncheck();
                await preview.locator('#publicAddress').waitFor({ state: 'hidden' });
                await userPage.locator('input[name="theme_showAddress"]').check();
                await preview.locator('#publicAddress').waitFor({ state: 'visible' });
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
                assert.equal(await publicPage.getByRole('link', { name: 'Website: https://example.com/alex', exact: true }).getAttribute('href'), 'https://example.com/alex');
                assert.equal(await publicPage.getByRole('link', { name: 'Email: alex@example.com', exact: true }).getAttribute('href'), 'mailto:alex@example.com');
                assert.equal(await publicPage.getByRole('link', { name: 'Phone: +15551234567', exact: true }).getAttribute('href'), 'tel:+15551234567');
                assert.match(await publicPage.locator('#publicAddress').getAttribute('href'), /google.com\/maps\/search/);
                assert.equal(await publicPage.locator('#publicAddress svg').isVisible(), true);
                assert.equal(await publicPage.locator('#publicActions a').first().evaluate(el => getComputedStyle(el).borderRadius), '14px');
                await publicPage.setViewportSize({ width: 390, height: 1000 });
                assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await publicPage.screenshot({ path: path.join(output, 'personal-public-card.png'), fullPage: true });
                await userContext.close();
                continue;
            }
            await userPage.locator('#accountAllowance').filter({ hasText: '2 of' }).waitFor({ state: 'attached' });
            assert.equal(await userPage.locator('#addProfileButton').isDisabled(), type === 'individual');
            assert.equal(await userPage.locator('[data-nav="company"]').isVisible(), type === 'company');
            assert.equal(await userPage.locator('#adminNavigationLink').count(), 0);
            await userPage.goto(base + '/dashboard/social.html');
            await userPage.waitForURL('**/dashboard/company.html');
            await userPage.locator('#companyTitle').filter({ hasText: 'Northstar Labs' }).waitFor();
            assert.equal(await userPage.locator('#dashboardView').isVisible(), true);
            assert.equal(await userPage.locator('[data-nav="social"]').count(), 0);
            assert.equal(await userPage.locator('#accountAllowance').isVisible(), false);
            await userPage.getByRole('button', { name: 'Edit company details' }).click();
            await userPage.locator('#companyDetailsForm input[name="name"]').fill('Northstar Studio');
            await userPage.locator('#companyDetailsForm input[name="contact_email"]').fill('company@northstar.example');
            await userPage.locator('#saveCompanyDetails').click();
            await userPage.locator('#companyProfileDialog').waitFor({ state: 'hidden' });
            await userPage.locator('[data-company-add-link="social"]').click();
            await userPage.locator('#companyLinkLabel').fill('Company LinkedIn');
            await userPage.locator('#companyLinkUrl').fill('https://linkedin.com/company/northstar');
            await userPage.locator('#saveCompanyLink').click();
            await userPage.locator('#companyLinkDialog').waitFor({ state: 'hidden' });
            assert.equal(await userPage.locator('#companySocialLinks a').textContent(), 'Company LinkedIn');
            await userPage.locator('#companySocialLinks button').click();
            await userPage.locator('#companyLinkLabel').fill('Follow Northstar');
            await userPage.locator('#saveCompanyLink').click();
            await userPage.locator('#companyLinkDialog').waitFor({ state: 'hidden' });
            await userPage.locator('#companyBannerInput').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('test-image') });
            await userPage.locator('#companyImageMessage').filter({ hasText: 'Banner updated' }).waitFor();
            await userPage.locator('#companyBannerPosition').fill('72');
            await userPage.locator('#saveCompanyPosition').click();
            await userPage.locator('#companyImageMessage').filter({ hasText: 'position saved' }).waitFor();
            await userPage.screenshot({ path: path.join(output, 'company-desktop.png'), fullPage: true });
            await userPage.goto(base + '/dashboard/index.html');
            await userPage.locator('#overviewCardTitle').filter({ hasText: 'Northstar Studio' }).waitFor();
            assert.match(await userPage.locator('#overviewContacts').textContent(), /company@northstar.example/);
            assert.equal(await userPage.locator('#overviewViewCard').count(), 0);
            await userPage.goto(base + '/dashboard/profile.html');
            await userPage.locator('.team-card').nth(1).waitFor();
            assert.equal(await userPage.locator('#accountAllowance').isVisible(), true);
            assert.equal(await userPage.locator('#accountAllowance').textContent(), 'Team profiles · 2 of 3 used.');
            await userPage.locator('#teamSearch').fill('Design');
            assert.equal(await userPage.locator('.team-card').count(), 1);
            assert.match(await userPage.locator('.team-card h3').textContent(), /Jamie/);
            await userPage.locator('#teamSearch').fill('');
            await userPage.locator('.team-card').filter({ hasText: 'Alex Morgan' }).getByRole('button', { name: 'Edit card' }).click();
            await userPage.locator('#teamEditorDialog').waitFor({ state: 'visible' });
            assert.equal(await userPage.locator('#contact_email').inputValue(), 'alex@example.com');
            assert.equal(await userPage.locator('#teamEditorDialog input[name="banner_path"]').count(), 0);
            assert.equal(await userPage.locator('#teamEditorDialog input[name="company_name"]').count(), 0);
            await userPage.locator('#department').fill('Engineering');
            await userPage.locator('#alternate_name').fill('أليكس');
            await userPage.locator('#booking_url').fill('https://example.com/alex-booking');
            await userPage.locator('#photoInput').setInputFiles({ name: 'alex.png', mimeType: 'image/png', buffer: Buffer.from('test-image') });
            await userPage.locator('#saveProfileButton').click();
            await userPage.locator('#profileMessage').filter({ hasText: 'Employee card saved' }).waitFor();
            await userPage.locator('#teamPreviewFrame').contentFrame().locator('#publicDepartment').filter({ hasText: 'Engineering' }).waitFor();
            await userPage.screenshot({ path: path.join(output, 'team-editor-desktop.png'), fullPage: true });
            await userPage.getByRole('button', { name: 'Close employee editor' }).click();
            await userPage.screenshot({ path: path.join(output, 'team-desktop.png'), fullPage: true });
            await userPage.goto(base + '/dashboard/theme.html');
            await userPage.locator('#saveCompanyTheme').waitFor({ state: 'visible' });
            await userPage.locator('[data-preset="forest"]').click();
            await userPage.locator('input[name="theme_accentColor"]').fill('#663399');
            await userPage.locator('select[name="theme_layout"]').selectOption('left');
            const companyPreview = userPage.locator('#companyThemePreviewFrame').contentFrame();
            await companyPreview.locator('#publicCard').waitFor({ state: 'visible' });
            await companyPreview.locator('#exchangeContactButton').waitFor({ state: 'visible' });
            await userPage.locator('#saveCompanyTheme').click();
            await userPage.locator('#companyThemeMessage').filter({ hasText: 'Theme applied' }).waitFor();
            await userPage.reload();
            await userPage.locator('input[name="theme_accentColor"]').waitFor();
            assert.equal(await userPage.locator('input[name="theme_accentColor"]').inputValue(), '#663399');
            await userPage.screenshot({ path: path.join(output, 'theme-desktop.png'), fullPage: true });
            for (const id of ['22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444']) {
                const publicPage = await userContext.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
                await publicPage.goto(base + '/card.html?id=' + id); await publicPage.locator('#publicCard').waitFor();
                assert.equal(await publicPage.locator('#publicCompany').textContent(), 'Northstar Studio');
                assert.equal(await publicPage.locator('#publicCard').evaluate(el => el.style.getPropertyValue('--card-accent')), '#663399');
                assert.equal(await publicPage.locator('#publicBanner').evaluate(el => el.style.objectPosition), 'center 72%');
                assert.equal(await publicPage.locator('#publicCompanyLinks a').textContent(), 'Follow Northstar');
                assert.match(await publicPage.locator('#publicActions').textContent(), id.startsWith('2222') ? /alex@example.com/ : /jamie@example.com/);
                assert.equal(await publicPage.getByRole('link', { name: 'Website: https://northstar.example/', exact: true }).getAttribute('href'), 'https://northstar.example/');
                assert.equal(await publicPage.locator('#publicAddress svg').isVisible(), true);
                if (id.startsWith('4444')) assert.equal(await publicPage.locator('#publicActions [data-contact-type="phone"]').count(), 0);
                await publicPage.setViewportSize({ width: 390, height: 1000 });
                assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                if (id.startsWith('2222')) {
                    await publicPage.screenshot({ path: path.join(output, 'company-public-card.png'), fullPage: true });
                    await publicPage.evaluate(() => window.BlipLinkCardTheme.apply(document.getElementById('publicCard'), window.BlipLinkCardTheme.presets.midnight, { surface: document.body }));
                    assert.equal(await publicPage.locator('#publicActions a').first().evaluate(el => getComputedStyle(el).color), 'rgb(244, 247, 255)');
                    await publicPage.screenshot({ path: path.join(output, 'company-public-card-dark.png'), fullPage: true });
                }
                await publicPage.close();
            }
            await userPage.setViewportSize({ width: 390, height: 844 });
            for (const route of ['index', 'profile', 'company', 'theme']) {
                await userPage.goto(base + `/dashboard/${route}.html`);
                await userPage.locator('#accountAllowance').filter({ hasText: '2 of' }).waitFor({ state: 'attached' });
                await userPage.locator('#companyTitle').filter({ hasText: 'Northstar Studio' }).waitFor({ state: 'attached' });
                assert.equal(await userPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, route + ' mobile overflow');
                assert.equal(await userPage.locator('#accountAllowance').isVisible(), route === 'profile', route + ' notice visibility');
                await userPage.screenshot({ path: path.join(output, `${route}-mobile.png`), fullPage: true });
                if (route === 'profile') {
                    await userPage.locator('.team-card').first().getByRole('button', { name: 'Edit card' }).click();
                    assert.equal(await userPage.locator('#teamEditorDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
                    await userPage.screenshot({ path: path.join(output, 'team-editor-mobile.png'), fullPage: true });
                    await userPage.getByRole('button', { name: 'Close employee editor' }).click();
                }
            }
            await userPage.goto(base + '/dashboard/subscription.html');
            await userPage.locator('#subscriptionStatus').filter({ hasText: 'Active' }).waitFor();
            assert.equal(await userPage.locator('#accountAllowance').isVisible(), false);
            assert.equal(await userPage.locator('#subscriptionPlan').textContent(), 'Yearly access');
            assert.notEqual(await userPage.locator('#subscriptionExpires').textContent(), '—');
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
                await pausedPage.locator('#subscriptionPlan').filter({ hasText: 'Monthly access' }).waitFor({ state: 'attached' });
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
