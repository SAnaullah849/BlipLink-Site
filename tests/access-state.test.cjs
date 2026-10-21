const assert = require('node:assert/strict');
const { test } = require('node:test');
const access = require('../dashboard/access-state.js');
test('access states never grant editing through truthy strings or missing setup', () => {
    assert.equal(access.normalize({ account_type: 'individual', can_edit: 'true' }).can_edit, false);
    assert.equal(access.normalize({ account_type: 'individual', can_edit: true, effective_status: 'expired' }).can_edit, false);
    assert.equal(access.normalize({ account_type: 'individual', can_edit: true, effective_status: 'active', configured: false }).can_edit, false);
    assert.equal(access.normalize(null), null);
    assert.equal(access.normalize({ account_type: 'admin', can_edit: true }), null);
    assert.match(access.message(null), /Editing is paused/);
});
test('monthly and yearly access messages explain active, scheduled, and expired access', () => {
    assert.equal(access.label({ access_period: 'monthly' }), 'Monthly access');
    assert.equal(access.label({ access_period: 'yearly' }), 'Yearly access');
    const state = { configured: true, access_period: 'monthly', expires_at: '2025-02-01', starts_at: '2025-01-01' };
    assert.match(access.message({ ...state, effective_status: 'expired' }), /public cards are hidden/);
    assert.match(access.message({ ...state, effective_status: 'scheduled' }), /starts/);
    assert.equal(access.date('invalid-date'), '—');
});
