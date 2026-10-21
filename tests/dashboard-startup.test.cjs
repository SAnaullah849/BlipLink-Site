const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const dashboardDirectory = path.join(__dirname, '..', 'dashboard');
const source = fs.readFileSync(path.join(dashboardDirectory, 'dashboard.js'), 'utf8');
const pages = ['index', 'profile', 'social', 'company', 'leads', 'crm', 'subscription', 'help'];

// Use each page's actual element IDs so missing controls behave as they do in a browser.
function createPage(page, sessionResult) {
    const html = fs.readFileSync(path.join(dashboardDirectory, `${page}.html`), 'utf8');
    const elements = new Map();
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const tag = match[0];
        elements.set(match[1], {
            hidden: /\bhidden\b/.test(tag),
            dataset: { dashboardPage: /data-dashboard-page="([^"]+)"/.exec(tag)?.[1] },
            addEventListener() {},
            classList: { toggle() {} },
            setAttribute() {},
            removeAttribute() {},
        });
    }
    const sections = [...html.matchAll(/<[^>]+data-dashboard-page="([^"]+)"[^>]*>/g)].map(match => {
        const id = /\bid="([^"]+)"/.exec(match[0])?.[1];
        return elements.get(id) || { dataset: { dashboardPage: match[1] }, hidden: false };
    });
    let initialize;
    let redirect;
    let sessionChecks = 0;
    const window = {
        location: { hash: '', replace(url) { redirect = url; } },
        addEventListener() {},
    };
    if (sessionResult) {
        window.BLIPLINK_SUPABASE_CONFIG = { url: 'https://example.invalid', anonKey: 'test-key' };
        window.supabase = { createClient: () => ({ auth: {
            async getSession() { sessionChecks++; return sessionResult; },
        } }) };
    }
    const document = {
        body: { dataset: { page: /<body data-page="([^"]+)"/.exec(html)[1] } },
        getElementById: id => elements.get(id) || null,
        addEventListener(event, callback) {
            if (event === 'DOMContentLoaded') initialize = callback;
        },
        querySelectorAll(selector) {
            if (selector === '[data-dashboard-page]') {
                return sections;
            }
            return [];
        },
    };
    vm.runInNewContext(source, { document, window });
    return { elements, sections, initialize, get redirect() { return redirect; }, get sessionChecks() { return sessionChecks; } };
}

for (const page of pages) {
    test(`${page}: missing configuration displays an error instead of a blank page`, async () => {
        const view = createPage(page);
        await view.initialize();
        assert.equal(view.elements.get('dashboardView').hidden, false);
        assert.equal(view.elements.get('dashboardMessage').hidden, false);
        assert.match(view.elements.get('dashboardMessage').textContent, /configuration is unavailable/);
        const selectedPage = page === 'index' ? 'overview' : page;
        assert.equal(view.elements.get('dashboardPageTitle').textContent.toLowerCase(), page === 'social' ? 'social links' : selectedPage);
        const sections = view.sections;
        assert.ok(sections.some(element => !element.hidden));
        for (const section of sections) {
            assert.equal(section.hidden, section.dataset.dashboardPage !== selectedPage);
        }
    });

    test(`${page}: initialization reaches authentication and shows sign-in errors`, async () => {
        const view = createPage(page, { error: { message: 'Session check failed' } });
        await view.initialize();
        assert.equal(view.sessionChecks, 1);
        assert.equal(view.elements.get('dashboardView').hidden, false);
        assert.match(view.elements.get('dashboardMessage').textContent, /Session check failed/);
    });

    test(`${page}: signed-out visitors reach the login page`, async () => {
        const view = createPage(page, { data: { session: null }, error: null });
        await view.initialize();
        assert.equal(view.redirect, '../login.html');
    });
}
