const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { createDatabase } = require('./helpers/database.cjs');
const setup = fs.readFileSync(require('node:path').join(__dirname, '../dashboard/setup.sql'), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const person = '33333333-3333-4333-8333-333333333333';

test('company branding is shared across cards, isolated by owner, and respects expiry', async t => {
    const db = await createDatabase(); t.after(() => db.close()); await db.exec(setup);
    const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
    async function actor(id, role = 'authenticated') { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']); if (id || role === 'anon') await db.exec(`set role ${role}`); }
    for (const [id, type, email] of [[owner, 'company', 'team@example.com'], [other, 'company', 'other@example.com'], [person, 'individual', 'person@example.com']]) {
        await db.query('insert into account_settings(email,account_type,profile_limit) values($1,$2,3)', [email, type]);
        await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    }
    const first = (await row('select id from company_profiles where user_id=$1', [owner])).id;
    await db.query("update company_profiles set full_name='Alex',contact_email='alex@example.com',phone='+15551234567',company_name='Legacy company',banner_path=$2,card_theme=$3,instagram_url='https://instagram.com/legacy',linkedin_url='http://linkedin.com/in/legacy' where id=$1", [first, `${owner}/old/banner.png`, { accentColor: '#dd2255' }]);
    await db.exec(setup);

    await t.test('upgrade copies company data once and leaves employee IDs and personal details intact', async () => {
        const brand = await row('select * from company_branding where user_id=$1', [owner]);
        assert.equal(brand.name, 'Legacy company'); assert.equal(brand.banner_path, `${owner}/old/banner.png`);
        assert.equal(brand.card_theme.accentColor, '#dd2255'); assert.ok(brand.custom_links.some(item => item.label === 'Instagram'));
        const employee = await row('select id,contact_email,phone from company_profiles where id=$1', [first]);
        assert.deepEqual(employee, { id: first, contact_email: 'alex@example.com', phone: '+15551234567' });
        assert.equal((await row('select count(*)::int n from company_profiles where user_id=$1', [owner])).n, 1);
    });

    let second;
    await t.test('personal edits and new employee cards cannot override company branding', async () => {
        await actor(owner);
        await db.query("update company_branding set custom_links=custom_links || $2::jsonb where user_id=$1", [owner, [{ id: 'new-link', label: 'New link', category: 'social', url: 'https://example.com/new' }]]);
        second = (await row("insert into company_profiles(user_id,full_name,contact_email) values($1,'Jamie','jamie@example.com') returning id", [owner])).id;
        await db.query("update company_profiles set department='Sales',secondary_phone='+15559876543',booking_url='https://example.com/book',alternate_name='جيمي',linkedin_url='https://linkedin.com/in/jamie' where id=$1", [second]);
        for (const [key, value] of [['banner_path', `${owner}/override.png`], ['company_name', 'Override'], ['website_url', 'https://override.example'], ['card_theme', { accentColor: '#000000' }]]) {
            await assert.rejects(db.query(`update company_profiles set ${key}=$1 where id=$2`, [value, second]), /Company or Theme/);
        }
        await assert.rejects(db.query("insert into company_profiles(user_id,banner_path) values($1,$2)", [owner, `${owner}/override.png`]), /Company or Theme/);
        await actor(null);
    });

    const links = [{ id: 'company-link', label: 'Our LinkedIn', url: 'https://linkedin.com/company/team', category: 'social' }, { id: 'app-link', label: 'Team app', url: 'https://example.com/app', category: 'web_app' }];
    await t.test('one company edit updates all public cards without overwriting personal contacts', async () => {
        await actor(owner);
        await db.query("update company_branding set name='New company',contact_email='company@example.com',banner_path=$2,banner_position=72,card_theme=$3,custom_links=$4,address='New office' where user_id=$1", [owner, `${owner}/company/banner.png`, { accentColor: '#2255dd', layout: 'left' }, links]);
        await actor(null, 'anon');
        for (const [id, email] of [[first, 'alex@example.com'], [second, 'jamie@example.com']]) {
            const card = await row('select * from get_public_company_card($1)', [id]);
            assert.equal(card.company_name, 'New company'); assert.equal(card.contact_email, email); assert.equal(card.banner_path, `${owner}/company/banner.png`); assert.equal(card.address, 'New office');
            assert.equal(card.instagram_url, null);
            const appearance = (await row('select get_public_card_appearance($1) data', [id])).data;
            assert.equal(appearance.theme.accentColor, '#2255dd'); assert.equal(appearance.banner_position, 72); assert.deepEqual(appearance.company_links, links);
        }
        const details = (await row('select get_public_card_appearance($1) data', [second])).data.personal_details;
        assert.equal(details.department, 'Sales'); assert.equal(details.alternate_name, 'جيمي'); assert.equal(details.booking_url, 'https://example.com/book');
        await actor(null);
    });

    await t.test('other companies, individual users and anonymous visitors cannot change branding', async () => {
        for (const id of [other, person]) {
            await actor(id);
            assert.equal((await db.query('select * from company_branding where user_id=$1', [owner])).rows.length, 0);
            assert.equal((await db.query("update company_branding set name='Stolen' where user_id=$1 returning *", [owner])).rows.length, 0);
            await assert.rejects(db.query('insert into company_branding(user_id) values($1)', [person]), /row-level security/);
        }
        await actor(null, 'anon'); await assert.rejects(db.exec('select * from company_branding'), /permission denied/); await actor(null);
    });

    await t.test('unsafe links, duplicate IDs and cross-account image paths are rejected', async () => {
        await actor(owner);
        await assert.rejects(db.query("update company_branding set website_url='javascript:alert(1)' where user_id=$1", [owner]), /https/);
        await assert.rejects(db.query('update company_branding set logo_path=$2 where user_id=$1', [owner, `${other}/logo.png`]), /belong/);
        await assert.rejects(db.query('update company_branding set custom_links=$2 where user_id=$1', [owner, [links[0], links[0]]]), /unique/);
        await assert.rejects(db.query('update company_branding set user_id=$2 where user_id=$1', [owner, other]), /ownership/);
        await actor(null);
    });

    await t.test('expired owners retain branding but cannot change it or expose public cards', async () => {
        await db.query("update account_settings set starts_at='2020-01-01',expires_at='2021-01-01' where user_id=$1", [owner]);
        await actor(owner);
        assert.equal((await row('select name from company_branding where user_id=$1', [owner])).name, 'New company');
        assert.equal((await db.query("update company_branding set name='Expired edit' where user_id=$1 returning *", [owner])).rows.length, 0);
        await actor(null, 'anon'); assert.equal((await db.query('select * from get_public_company_card($1)', [first])).rows.length, 0);
        assert.equal((await row('select get_public_card_appearance($1) data', [first])).data, null); await actor(null);
        await db.exec("select renew_account_access('team@example.com')");
    });

    await t.test('individual cards keep their own banner, company name and theme', async () => {
        await actor(person);
        await db.query("update company_profiles set full_name='Independent',company_name='Personal studio',card_theme=$2,banner_path=$3 where user_id=$1", [person, { accentColor: '#225533' }, `${person}/personal.png`]);
        const id = (await row('select id from company_profiles where user_id=$1', [person])).id;
        await actor(null, 'anon'); const card = await row('select * from get_public_company_card($1)', [id]);
        assert.equal(card.company_name, 'Personal studio'); assert.equal(card.banner_path, `${person}/personal.png`);
        assert.equal((await row('select get_public_card_appearance($1) data', [id])).data.theme.accentColor, '#225533'); await actor(null);
    });

    await t.test('repeat setup preserves company customization and links', async () => {
        await db.exec(setup); const brand = await row('select * from company_branding where user_id=$1', [owner]);
        assert.equal(brand.name, 'New company'); assert.equal(brand.card_theme.accentColor, '#2255dd'); assert.deepEqual(brand.custom_links, links);
    });
});
