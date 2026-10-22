const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createDatabase } = require('./helpers/database.cjs');
const { buildSetup } = require('../scripts/build-database-setup.cjs');
const setup = fs.readFileSync(path.join(__dirname, '../dashboard/setup.sql'), 'utf8');
const company = '11111111-1111-4111-8111-111111111111';
const individual = '22222222-2222-4222-8222-222222222222';
const legacy = '33333333-3333-4333-8333-333333333333';

test('the single setup file matches its maintained SQL components', () => assert.equal(setup, buildSetup()));

test('complete Supabase setup provisions, secures, expires, and renews accounts', async t => {
    const db = await createDatabase();
    t.after(() => db.close());
    await db.query('insert into auth.users(id,email) values($1,$2)', [legacy, 'legacy@example.com']);
    await db.exec(setup);
    const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
    const actor = async id => {
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
        if (id) await db.exec('set role authenticated');
    };

    await t.test('fresh setup backfills existing cards and preserves account data', async () => {
        assert.equal((await row('select count(*)::int as count from company_profiles where user_id=$1', [legacy])).count, 1);
        assert.deepEqual(await row('select account_type,profile_limit,access_status from account_settings where user_id=$1', [legacy]),
            { account_type: 'company', profile_limit: 1, access_status: 'inactive' });
        assert.equal((await row("select to_regclass('public.app_admins') as name")).name, null);
    });

    await t.test('prepare a company email, then Auth creation claims its monthly access and profile allowance', async () => {
        await db.query("insert into account_settings(email,account_type,profile_limit,access_period) values($1,'company',3,'monthly')", [' COMPANY@example.com ']);
        let prepared = await row("select user_id,starts_at,expires_at from account_settings where email='company@example.com'");
        assert.equal(prepared.user_id, null); assert.equal(prepared.starts_at, null); assert.equal(prepared.expires_at, null);
        await db.query('insert into auth.users(id,email) values($1,$2)', [company, 'company@example.com']);
        prepared = await row('select * from account_settings where user_id=$1', [company]);
        assert.equal(prepared.profile_limit, 3); assert.equal(prepared.access_period, 'monthly'); assert.equal(prepared.access_status, 'active');
        assert.ok(new Date(prepared.expires_at) > new Date(prepared.starts_at));
        assert.equal((await row('select account_is_active($1) as active', [company])).active, true);
        assert.deepEqual(await row('select account_type,profile_limit from account_access where user_id=$1', [company]), { account_type: 'company', profile_limit: 3 });
        assert.equal((await row('select count(*)::int as count from company_profiles where user_id=$1', [company])).count, 1);
    });

    await t.test('unprepared users get only one inactive individual profile and metadata cannot upgrade access', async () => {
        await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [individual, 'individual@example.com',
            { account_type: 'company', profile_limit: 999, access_status: 'active', is_admin: true }]);
        assert.deepEqual(await row('select account_type,profile_limit,access_status from account_settings where user_id=$1', [individual]),
            { account_type: 'individual', profile_limit: 1, access_status: 'inactive' });
        await db.query("update account_settings set access_status='active',access_period='yearly',profile_limit=100 where user_id=$1", [individual]);
        assert.equal((await row('select profile_limit from account_settings where user_id=$1', [individual])).profile_limit, 1);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1)', [individual]), /Profile limit reached/);
    });

    await t.test('calendar months and years calculate expiry correctly', async () => {
        await db.query("update account_settings set starts_at='2024-01-31T12:00:00Z',access_period='monthly',expires_at=null where user_id=$1", [company]);
        assert.equal(new Date((await row('select expires_at from account_settings where user_id=$1', [company])).expires_at).toISOString(), '2024-02-29T12:00:00.000Z');
        await db.query("update account_settings set starts_at='2024-02-29T12:00:00Z',access_period='yearly' where user_id=$1", [company]);
        assert.equal(new Date((await row('select expires_at from account_settings where user_id=$1', [company])).expires_at).toISOString(), '2025-02-28T12:00:00.000Z');
        await db.query("update account_settings set starts_at=now(),access_period='monthly' where user_id=$1", [company]);
    });

    await t.test('profile quotas are enforced atomically and reductions preserve existing cards', async () => {
        await db.query('insert into company_profiles(user_id) values($1)', [company]);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1),($1)', [company]), /Profile limit reached/);
        assert.equal((await row('select count(*)::int as count from company_profiles where user_id=$1', [company])).count, 2);
        await assert.rejects(db.query("update account_settings set account_type='individual' where user_id=$1", [company]), /Remove extra profiles/);
        await assert.rejects(db.query('update account_settings set profile_limit=1 where user_id=$1', [company]), /Remove extra profiles/);
        await assert.rejects(db.query('update company_profiles set user_id=$1 where user_id=$2', [individual, company]), /ownership cannot be changed/);
    });

    await t.test('customers can read only their settings and cannot change type, allowance, dates, or renewals', async () => {
        await actor(individual);
        assert.deepEqual((await db.query('select email from account_settings')).rows, [{ email: 'individual@example.com' }]);
        await assert.rejects(db.exec('select notes from account_settings'), /permission denied/);
        await assert.rejects(db.exec("update account_settings set account_type='company',profile_limit=50"), /permission denied/);
        await assert.rejects(db.exec('update account_access set profile_limit=50'), /permission denied/);
        await assert.rejects(db.exec("update company_subscriptions set status='active'"), /permission denied/);
        await assert.rejects(db.exec("select renew_account_access('individual@example.com')"), /permission denied/);
        const access = await row('select * from get_my_account_access()');
        assert.equal(access.access_period, 'yearly'); assert.equal(access.can_edit, true);
        await actor(null);
    });

    await t.test('active companies have CRM access and individuals do not', async () => {
        await actor(individual);
        await assert.rejects(db.query('insert into crm_leads(owner_id,full_name) values($1,$2)', [individual, 'A lead']), /row-level security/);
        await actor(company);
        await db.query('insert into crm_leads(owner_id,full_name) values($1,$2)', [company, 'Company lead']);
        assert.equal((await db.query('select * from crm_leads')).rows.length, 1);
        await actor(null);
    });

    const profileId = (await row('select id from company_profiles where user_id=$1 order by created_at limit 1', [company])).id;
    await db.query("update company_profiles set full_name='Company contact',card_theme=$1 where id=$2", [{ accentColor: '#cc2244' }, profileId]);
    await db.query('insert into company_branding(user_id,card_theme) values($1,$2)', [company, { accentColor: '#cc2244' }]);

    await t.test('active public cards and appearance render without exposing private account settings', async () => {
        await db.exec('set role anon');
        assert.equal((await db.query('select * from get_public_company_card($1)', [profileId])).rows[0].full_name, 'Company contact');
        const appearance = (await row('select get_public_card_appearance($1) as value', [profileId])).value;
        assert.equal(appearance.theme.accentColor, '#cc2244'); assert.equal(appearance.account_type, 'company');
        assert.equal(Object.hasOwn(appearance, 'email'), false);
        await db.exec('reset role');
    });

    await t.test('expiry blocks profile edits, creation, deletion, assets, CRM, analytics, and public cards', async () => {
        await db.query("update account_settings set starts_at='2020-01-01',expires_at='2021-01-01' where user_id=$1", [company]);
        await actor(company);
        assert.equal((await row('select * from get_my_account_access()')).effective_status, 'expired');
        await assert.rejects(db.query("update company_profiles set full_name='Changed' where id=$1", [profileId]), /access has ended/);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1)', [company]), /access has ended/);
        await assert.rejects(db.query('select delete_company_profile($1)', [profileId]), /access has ended/);
        await assert.rejects(db.query('insert into crm_leads(owner_id,full_name) values($1,$2)', [company, 'Blocked']), /row-level security/);
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${company}/file.png`]), /row-level security/);
        assert.equal((await db.query('select * from crm_leads')).rows.length, 0);
        await actor(null);
        assert.equal((await db.query('select * from get_public_company_card($1)', [profileId])).rows.length, 0);
        assert.equal((await row('select get_public_card_appearance($1) as value', [profileId])).value, null);
        await assert.rejects(db.query("select record_public_card_event($1,'view',null,null)", [profileId]), /unavailable/);
    });

    await t.test('renewal restores public cards and editing without changing card URLs or themes', async () => {
        await db.query('select renew_account_access($1)', ['company@example.com']);
        assert.equal((await row('select account_is_active($1) as active', [company])).active, true);
        await actor(company);
        await db.query("update company_profiles set job_title='Designer' where id=$1", [profileId]);
        await actor(null);
        assert.equal((await db.query('select * from get_public_company_card($1)', [profileId])).rows[0].job_title, 'Designer');
        assert.equal((await row('select card_theme from company_profiles where id=$1', [profileId])).card_theme.accentColor, '#cc2244');
        const before = await row('select expires_at from account_settings where user_id=$1', [company]);
        await db.query('select renew_account_access($1,2)', ['company@example.com']);
        const difference = await row('select expires_at = $1::timestamptz + interval \'2 months\' as correct from account_settings where user_id=$2', [before.expires_at, company]);
        assert.equal(difference.correct, true);
    });

    await t.test('scheduled and inactive accounts also hide cards', async () => {
        await db.query("update account_settings set starts_at=now()+interval '1 day',expires_at=null where user_id=$1", [company]);
        assert.equal((await row('select account_is_active($1) as active', [company])).active, false);
        await db.query("update account_settings set access_status='inactive' where user_id=$1", [company]);
        assert.equal((await row('select account_is_active($1) as active', [company])).active, false);
        await db.query("update account_settings set access_status='active' where user_id=$1", [company]);
        assert.equal((await row('select account_is_active($1) as active', [company])).active, true);
    });

    await t.test('changing a login email preserves ownership, limits, and access', async () => {
        await db.query("update auth.users set email='new-company@example.com' where id=$1", [company]);
        const settings = await row('select email,profile_limit,access_period from account_settings where user_id=$1', [company]);
        assert.deepEqual(settings, { email: 'new-company@example.com', profile_limit: 3, access_period: 'monthly' });
    });

    await t.test('rerunning the complete setup preserves access, settings, cards, and themes', async () => {
        const before = await row('select starts_at,expires_at from account_settings where user_id=$1', [company]);
        await db.exec(setup);
        const after = await row('select starts_at,expires_at from account_settings where user_id=$1', [company]);
        assert.deepEqual(after, before);
        assert.equal((await row('select profile_limit from account_settings where user_id=$1', [company])).profile_limit, 3);
        assert.equal((await row('select card_theme from company_profiles where id=$1', [profileId])).card_theme.accentColor, '#cc2244');
        assert.equal((await row('select account_is_active($1) as active', [company])).active, true);
    });
});

test('upgrade keeps existing active companies and removes the previous in-app admin objects', async t => {
    const db = await createDatabase();
    t.after(() => db.close());
    await db.exec(fs.readFileSync(path.join(__dirname, '../dashboard/schema.sql'), 'utf8'));
    await db.query('insert into auth.users(id,email) values($1,$2)', [legacy, 'existing@example.com']);
    await db.exec(`
        create table public.account_access(user_id uuid primary key references auth.users(id), account_type text default 'individual',
            profile_limit integer default 1, updated_at timestamptz default now());
        insert into account_access(user_id,account_type,profile_limit) values('${legacy}','company',17);
        create table public.app_admins(user_id uuid primary key references auth.users(id));
        insert into app_admins(user_id) values('${legacy}');
        create function public.set_bliplink_administrator(uuid,boolean) returns void language plpgsql as $$ begin return; end; $$;
        update company_subscriptions set status='active',starts_at=now(),expires_at=now()+interval '1 year' where user_id='${legacy}';
        update company_profiles set full_name='Existing company contact' where user_id='${legacy}';
    `);
    const before = (await db.query('select id from company_profiles where user_id=$1', [legacy])).rows[0].id;
    const expiry = (await db.query('select expires_at from company_subscriptions where user_id=$1', [legacy])).rows[0].expires_at;
    await db.exec(setup);
    const settings = (await db.query('select account_type,profile_limit,access_period,access_status,expires_at from account_settings where user_id=$1', [legacy])).rows[0];
    assert.equal(settings.account_type, 'company'); assert.equal(settings.profile_limit, 17);
    assert.equal(settings.access_period, 'yearly'); assert.equal(settings.access_status, 'active');
    assert.deepEqual(settings.expires_at, expiry);
    assert.equal((await db.query('select id from company_profiles where user_id=$1', [legacy])).rows[0].id, before);
    assert.equal((await db.query("select to_regclass('public.app_admins') as name")).rows[0].name, null);
    assert.equal((await db.query("select to_regprocedure('public.set_bliplink_administrator(uuid,boolean)') as name")).rows[0].name, null);
    assert.equal((await db.query('select * from get_public_company_card($1)', [before])).rows[0].full_name, 'Existing company contact');
});
