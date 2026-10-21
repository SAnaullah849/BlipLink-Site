const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../api/admin-accounts.js'), 'utf8');
const adminId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const verifiedUser = { id: adminId };
const adminMembership = [{ user_id: adminId }];

async function run({ method = 'GET', body, replies = [], headers = {}, query = {}, configured = true } = {}) {
    const calls = [];
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module, URL, AbortSignal,
        process: { env: configured ? { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' } : {} },
        fetch: async (url, options) => {
            calls.push({ url, ...options });
            const reply = replies.shift();
            assert.ok(reply, `Unexpected request: ${url}`);
            if (reply instanceof Error) throw reply;
            const status = reply.status || 200;
            return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(reply.data) };
        },
    });
    const response = { headers: {}, statusCode: 200,
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
    };
    await module.exports({ method, body, query, headers: {
        authorization: 'Bearer user-token', origin: 'https://bliplink.example', host: 'bliplink.example', ...headers,
    } }, response);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(response.body).includes('server-secret'));
    return { response, calls };
}
const authorized = (...replies) => [{ data: verifiedUser }, { data: adminMembership }, ...replies];

test('anonymous callers cannot access accounts', async () => {
    const { response, calls } = await run({ headers: { authorization: undefined } });
    assert.equal(response.statusCode, 401); assert.equal(calls.length, 0);
});
test('forged administrator metadata does not grant access', async () => {
    const { response, calls } = await run({ replies: [
        { data: { ...verifiedUser, user_metadata: { is_admin: true }, app_metadata: { role: 'admin' } } }, { data: [] },
    ] });
    assert.equal(response.statusCode, 403); assert.equal(calls.length, 2);
});
test('expired tokens are rejected before querying administrators', async () => {
    const { response, calls } = await run({ replies: [{ status: 401, data: {} }] });
    assert.equal(response.statusCode, 401); assert.equal(calls.length, 1);
});
test('cross-origin writes are rejected before authentication', async () => {
    const { response, calls } = await run({ method: 'POST', headers: { origin: 'https://attacker.example' } });
    assert.equal(response.statusCode, 403); assert.equal(calls.length, 0);
});
test('missing server configuration gives a setup message', async () => {
    const { response } = await run({ configured: false });
    assert.equal(response.statusCode, 503);
});
test('missing account migration fails closed', async () => {
    const { response } = await run({ replies: [{ data: verifiedUser }, { status: 404, data: {} }] });
    assert.equal(response.statusCode, 503);
});
test('authorized listing uses service role only after verifying user identity', async () => {
    const { response, calls } = await run({ query: { page: '2' }, replies: authorized({ data: [{ user_id: userId }] }) });
    assert.equal(response.statusCode, 200);
    assert.equal(calls[0].headers.Authorization, 'Bearer user-token');
    assert.equal(calls[2].headers.Authorization, 'Bearer server-secret');
    assert.deepEqual(JSON.parse(calls[2].body), { requested_page: 2 });
});
test('company invitations save the selected type and profile allowance', async () => {
    const { response, calls } = await run({ method: 'POST', body: {
        email: ' person@example.com ', accountType: 'company', profileLimit: 12,
    }, replies: authorized({ data: { id: userId } }, { data: [{ user_id: userId, account_type: 'company', profile_limit: 12 }] }) });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(JSON.parse(calls[2].body), { email: 'person@example.com' });
    assert.deepEqual(JSON.parse(calls[3].body), { account_type: 'company', profile_limit: 12 });
});
test('individual invitations always receive one profile', async () => {
    const { response, calls } = await run({ method: 'POST', body: {
        email: 'person@example.com', accountType: 'individual', profileLimit: 999, isAdmin: true,
    }, replies: authorized({ data: { id: userId } }, { data: [{ user_id: userId }] }) });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(JSON.parse(calls[3].body), { account_type: 'individual', profile_limit: 1 });
});
test('invalid quotas never send invitations', async () => {
    for (const profileLimit of [0, -1, 2.5, '5', 100001, null]) {
        const { response, calls } = await run({ method: 'POST', body: { email: 'person@example.com', accountType: 'company', profileLimit }, replies: authorized() });
        assert.equal(response.statusCode, 400); assert.equal(calls.length, 2);
    }
});
test('invalid invitation email is rejected', async () => {
    const { response, calls } = await run({ method: 'POST', body: { email: 'invalid', accountType: 'individual' }, replies: authorized() });
    assert.equal(response.statusCode, 400); assert.equal(calls.length, 2);
});
test('failed invitation does not change existing account access', async () => {
    const { response, calls } = await run({ method: 'POST', body: { email: 'existing@example.com', accountType: 'company', profileLimit: 10 },
        replies: authorized({ status: 422, data: { msg: 'User already exists' } }) });
    assert.equal(response.statusCode, 400); assert.equal(calls.length, 3);
});
test('partial invitation failure tells admin to edit instead of reinviting', async () => {
    const { response } = await run({ method: 'POST', body: { email: 'person@example.com', accountType: 'company', profileLimit: 10 },
        replies: authorized({ data: { id: userId } }, { status: 500, data: {} }) });
    assert.equal(response.statusCode, 502); assert.equal(response.body.invitationSent, true);
    assert.match(response.body.error, /before sending another invitation/);
});
test('invalid target IDs cannot inject database filters', async () => {
    const { response, calls } = await run({ method: 'PATCH', body: { userId: 'x&user_id=not.is.null', accountType: 'company', profileLimit: 5 }, replies: authorized() });
    assert.equal(response.statusCode, 400); assert.equal(calls.length, 2);
});
test('quota reduction conflicts are actionable', async () => {
    const { response } = await run({ method: 'PATCH', body: { userId, accountType: 'individual' },
        replies: authorized({ status: 400, data: { message: 'Remove extra profiles before reducing its allowance.' } }) });
    assert.equal(response.statusCode, 409);
});
test('administrator permissions use a separate server-only operation', async () => {
    const { response, calls } = await run({ method: 'PATCH', body: { action: 'administrator', userId, isAdmin: true },
        replies: authorized({ status: 204, data: null }) });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(calls[2].body), { requested_user_id: userId, requested_admin: true });
});
test('last administrator removal returns a conflict', async () => {
    const { response } = await run({ method: 'PATCH', body: { action: 'administrator', userId: adminId, isAdmin: false },
        replies: authorized({ status: 400, data: { message: 'The last administrator cannot be removed.' } }) });
    assert.equal(response.statusCode, 409);
});
