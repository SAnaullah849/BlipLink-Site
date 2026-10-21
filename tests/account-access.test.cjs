const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

test('PostgreSQL enforces account allowances, isolation, and administrator transfers', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    const company = '11111111-1111-4111-8111-111111111111';
    const individual = '22222222-2222-4222-8222-222222222222';
    const migration = fs.readFileSync(path.join(__dirname, '../dashboard/account-access.sql'), 'utf8');
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        grant usage on schema public, auth to authenticated, service_role;
        create function auth.uid() returns uuid language sql as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), raw_user_meta_data jsonb);
        create table public.company_profiles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), contact_email text,
            full_name text default 'Test professional', is_locked boolean not null default false);
        create table public.card_contact_exchanges(id bigint primary key, card_owner_id uuid);
        create table public.crm_leads(id uuid primary key default gen_random_uuid(), owner_id uuid, source_exchange_id bigint);
        alter table public.crm_leads enable row level security;
        grant select,insert,update,delete on public.crm_leads to authenticated;
        grant select on public.card_contact_exchanges to authenticated;
        insert into auth.users(id,email) values('${company}', 'company@example.com');
        insert into company_profiles(user_id) values('${company}'), ('${company}');
    `);
    await db.exec(migration);
    const themeMigration = fs.readFileSync(path.join(__dirname, '../dashboard/card-themes.sql'), 'utf8');
    await db.exec(themeMigration);
    await db.exec(`create trigger on_auth_user_created_company_profile after insert on auth.users
        for each row execute function public.create_company_profile_for_new_user();`);

    await t.test('migration preserves existing company profiles and capacity', async () => {
        const result = await db.query('select account_type,profile_limit from account_access where user_id=$1', [company]);
        assert.deepEqual(result.rows[0], { account_type: 'company', profile_limit: 2 });
        assert.equal((await db.query('select count(*)::int as count from company_profiles')).rows[0].count, 2);
    });

    await t.test('new users receive exactly one individual profile; metadata cannot grant access', async () => {
        await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`, [individual,
            'individual@example.com', { account_type: 'company', profile_limit: 999, is_admin: true }]);
        assert.deepEqual((await db.query('select account_type,profile_limit from account_access where user_id=$1', [individual])).rows[0],
            { account_type: 'individual', profile_limit: 1 });
        assert.equal((await db.query('select count(*)::int as count from company_profiles where user_id=$1', [individual])).rows[0].count, 1);
        assert.equal((await db.query('select count(*)::int as count from app_admins')).rows[0].count, 0);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1)', [individual]), /Profile limit reached/);
    });

    await t.test('company limits reject extra profiles including a multi-row insert', async () => {
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1)', [company]), /Profile limit reached/);
        await db.query('update account_access set profile_limit=3 where user_id=$1', [company]);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1),($1)', [company]), /Profile limit reached/);
        assert.equal((await db.query('select count(*)::int as count from company_profiles where user_id=$1', [company])).rows[0].count, 2);
        await db.query('insert into company_profiles(user_id) values($1)', [company]);
        await assert.rejects(db.query('insert into company_profiles(user_id) values($1)', [company]), /Profile limit reached/);
    });

    await t.test('limits and account conversion cannot discard existing profiles', async () => {
        await assert.rejects(db.query('update account_access set profile_limit=2 where user_id=$1', [company]), /Remove extra profiles/);
        await assert.rejects(db.query("update account_access set account_type='individual',profile_limit=1 where user_id=$1", [company]), /Remove extra profiles/);
        assert.equal((await db.query('select count(*)::int as count from company_profiles where user_id=$1', [company])).rows[0].count, 3);
    });

    await t.test('profile transfers cannot evade the quota', async () => {
        await assert.rejects(db.query('update company_profiles set user_id=$1 where user_id=$2', [individual, company]), /ownership cannot be changed/);
    });

    await t.test('ordinary users can read only their allowance and cannot change access or admins', async () => {
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${individual}', false);`);
        const rows = (await db.query('select user_id from account_access')).rows;
        assert.deepEqual(rows, [{ user_id: individual }]);
        await assert.rejects(db.exec('update account_access set profile_limit=100'), /permission denied/);
        await assert.rejects(db.exec(`insert into app_admins(user_id) values('${individual}')`), /permission denied/);
        await assert.rejects(db.exec('select * from list_bliplink_accounts(1)'), /permission denied/);
        await assert.rejects(db.exec(`select set_bliplink_administrator('${individual}',true)`), /permission denied/);
        await db.exec('reset role');
    });

    await t.test('admin transfers preserve at least one administrator and support email changes', async () => {
        await db.exec(`set role service_role; select set_bliplink_administrator('${company}',true);`);
        await assert.rejects(db.exec(`select set_bliplink_administrator('${company}',false)`), /last administrator/);
        await db.exec(`select set_bliplink_administrator('${individual}',true); select set_bliplink_administrator('${company}',false); reset role;`);
        await db.query("update auth.users set email='new-admin@example.com' where id=$1", [individual]);
        assert.deepEqual((await db.query('select user_id from app_admins')).rows, [{ user_id: individual }]);
    });

    await t.test('rerunning migration preserves changed limits, account types, and admin rights', async () => {
        await db.exec(migration);
        assert.deepEqual((await db.query('select account_type,profile_limit from account_access where user_id=$1', [individual])).rows[0],
            { account_type: 'individual', profile_limit: 1 });
        assert.equal((await db.query('select profile_limit from account_access where user_id=$1', [company])).rows[0].profile_limit, 3);
        assert.deepEqual((await db.query('select user_id from app_admins')).rows, [{ user_id: individual }]);
    });

    await t.test('card appearance is public only for available cards and preserves saved settings', async () => {
        const id = (await db.query('select id from company_profiles where user_id=$1', [individual])).rows[0].id;
        await db.query('update company_profiles set card_theme=$1 where id=$2', [{ accentColor: '#cc2244', layout: 'left' }, id]);
        await db.exec('set role anon');
        const result = await db.query('select get_public_card_appearance($1) as appearance', [id]);
        assert.deepEqual(result.rows[0].appearance, { account_type: 'individual', theme: { accentColor: '#cc2244', layout: 'left' } });
        await db.exec('reset role');
        await db.query('update company_profiles set is_locked=true where id=$1', [id]);
        assert.equal((await db.query('select get_public_card_appearance($1) as appearance', [id])).rows[0].appearance, null);
        await db.query('update company_profiles set is_locked=false where id=$1', [id]);
        await db.exec(themeMigration);
        assert.equal((await db.query('select card_theme from company_profiles where id=$1', [id])).rows[0].card_theme.accentColor, '#cc2244');
        await assert.rejects(db.query('update company_profiles set card_theme=$1 where id=$2', [[], id]), /check constraint/);
        await assert.rejects(db.query('update company_profiles set card_theme=$1 where id=$2', [{ giant: 'x'.repeat(9000) }, id]), /check constraint/);
    });

    await t.test('individuals cannot use CRM even through direct database requests', async () => {
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${individual}', false);`);
        await assert.rejects(db.query('insert into crm_leads(owner_id) values($1)', [individual]), /row-level security/);
        assert.deepEqual((await db.query('select * from crm_leads')).rows, []);
        await db.exec(`select set_config('request.jwt.claim.sub', '${company}', false);`);
        await db.query('insert into crm_leads(owner_id) values($1)', [company]);
        assert.equal((await db.query('select * from crm_leads')).rows.length, 1);
        await assert.rejects(db.query('insert into crm_leads(owner_id) values($1)', [individual]), /row-level security/);
        await db.exec('reset role');
    });
});
