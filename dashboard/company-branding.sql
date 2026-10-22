-- Company identity and branding are separate from the employee profile quota.
begin;

create table if not exists public.company_branding (
    user_id uuid primary key references auth.users(id) on delete cascade,
    name text not null default '' check(char_length(name) <= 120),
    contact_email text check(char_length(contact_email) <= 254),
    phone text check(char_length(phone) <= 40),
    address text check(char_length(address) <= 300),
    website_url text check(char_length(website_url) <= 500),
    bio text check(char_length(bio) <= 500),
    logo_path text check(char_length(logo_path) <= 1000),
    banner_path text check(char_length(banner_path) <= 1000),
    banner_position integer not null default 50 check(banner_position between 0 and 100),
    custom_links jsonb not null default '[]' check(jsonb_typeof(custom_links) = 'array' and octet_length(custom_links::text) <= 32768),
    apple_wallet_url text check(char_length(apple_wallet_url) <= 500),
    google_wallet_url text check(char_length(google_wallet_url) <= 500),
    card_theme jsonb not null default '{}' check(jsonb_typeof(card_theme) = 'object' and octet_length(card_theme::text) <= 8192),
    updated_at timestamptz not null default now()
);

alter table public.company_profiles
    add column if not exists department text check(char_length(department) <= 100),
    add column if not exists alternate_name text check(char_length(alternate_name) <= 100),
    add column if not exists alternate_job_title text check(char_length(alternate_job_title) <= 100),
    add column if not exists secondary_phone text check(char_length(secondary_phone) <= 40),
    add column if not exists booking_url text check(char_length(booking_url) <= 500);

-- Copy the oldest card's company details once. Never rewrite existing branding,
-- employee records, card IDs, analytics, or subscriptions during an upgrade.
-- Reinstall validation after the owner-only backfill so legacy HTTP links do
-- not prevent a newly converted company's existing data from being preserved.
drop trigger if exists validate_company_branding on public.company_branding;
insert into public.company_branding(user_id,name,contact_email,phone,address,website_url,bio,
    logo_path,banner_path,custom_links,apple_wallet_url,google_wallet_url,card_theme)
select account.user_id,coalesce(profile.company_name,''),profile.contact_email,profile.phone,
    profile.address,profile.website_url,profile.bio,profile.avatar_path,profile.banner_path,
    coalesce(profile.custom_links,'[]') || coalesce((select jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid()::text, 'category','social','label',social.label,'url',social.url))
        from (values ('LinkedIn',profile.linkedin_url),('Instagram',profile.instagram_url),
            ('X',profile.x_url),('Facebook',profile.facebook_url),('TikTok',profile.tiktok_url),
            ('GitHub',profile.github_url),('Telegram',profile.telegram_url),('Discord',profile.discord_url),
            ('Snapchat',profile.snapchat_url),('WhatsApp',profile.whatsapp_url)) social(label,url)
        where nullif(btrim(social.url),'') is not null),'[]'),
    profile.apple_wallet_url,profile.google_wallet_url,coalesce(profile.card_theme,'{}')
from public.account_settings account
left join lateral (select * from public.company_profiles p where p.user_id=account.user_id
    order by p.created_at,p.id limit 1) profile on true
where account.account_type='company' and account.user_id is not null
    and not exists(select 1 from public.company_branding existing where existing.user_id=account.user_id)
on conflict(user_id) do nothing;

alter table public.company_branding enable row level security;
revoke all on public.company_branding from public,anon,authenticated;
grant select,insert,update on public.company_branding to authenticated;
grant all on public.company_branding to service_role;
drop policy if exists "Company owners read branding" on public.company_branding;
create policy "Company owners read branding" on public.company_branding for select to authenticated
    using(user_id=(select auth.uid()) and exists(select 1 from public.account_settings a
        where a.user_id=(select auth.uid()) and a.account_type='company'));
drop policy if exists "Active company owners create branding" on public.company_branding;
create policy "Active company owners create branding" on public.company_branding for insert to authenticated
    with check(user_id=(select auth.uid()) and public.account_is_active(user_id)
        and exists(select 1 from public.account_settings a where a.user_id=(select auth.uid()) and a.account_type='company'));
drop policy if exists "Active company owners update branding" on public.company_branding;
create policy "Active company owners update branding" on public.company_branding for update to authenticated
    using(user_id=(select auth.uid()) and public.account_is_active(user_id)
        and exists(select 1 from public.account_settings a where a.user_id=(select auth.uid()) and a.account_type='company'))
    with check(user_id=(select auth.uid()) and public.account_is_active(user_id)
        and exists(select 1 from public.account_settings a where a.user_id=(select auth.uid()) and a.account_type='company'));

create or replace function public.validate_company_branding()
returns trigger language plpgsql set search_path='' as $$
declare item jsonb; field text; value text;
begin
    if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
        raise exception 'Company ownership cannot be changed.';
    end if;
    foreach field in array array['website_url','apple_wallet_url','google_wallet_url'] loop
        value := to_jsonb(new)->>field;
        if nullif(value,'') is not null and value !~* '^https://[^[:space:]]+$'
            and (tg_op='INSERT' or to_jsonb(new)->field is distinct from to_jsonb(old)->field) then
            raise exception 'Company links must use https://.';
        end if;
    end loop;
    if tg_op='INSERT' or new.custom_links is distinct from old.custom_links then
    for item in select * from jsonb_array_elements(new.custom_links) loop
        -- Legacy links are preserved during upgrades. Validate each new or
        -- edited entry without forcing unrelated old links to be rewritten.
        if tg_op='UPDATE' and old.custom_links @> jsonb_build_array(item) then continue; end if;
        if jsonb_typeof(item)<>'object' or coalesce(item->>'category','') not in ('social','play_store','app_store','web_app')
            or coalesce(item->>'label','')='' or char_length(item->>'label')>80
            or coalesce(item->>'id','')='' or char_length(item->>'id')>100
            or coalesce(item->>'url','') !~* '^https://[^[:space:]]+$' or char_length(item->>'url')>500 then
            raise exception 'Each company link needs a name, ID, category, and valid https:// URL.';
        end if;
    end loop;
    if (select count(*)<>count(distinct entry.value->>'id') from jsonb_array_elements(new.custom_links) as entry(value)) then
        raise exception 'Company link IDs must be unique.';
    end if;
    end if;
    -- Company images must belong to the same storage folder as the owner.
    foreach field in array array['logo_path','banner_path'] loop
        value:=to_jsonb(new)->>field;
        if value is not null and (split_part(value,'/',1)<>new.user_id::text or value like '%..%') then
            raise exception 'Company images must belong to this account.';
        end if;
    end loop;
    new.updated_at:=now(); return new;
end;
$$;
drop trigger if exists validate_company_branding on public.company_branding;
create trigger validate_company_branding before insert or update on public.company_branding
    for each row execute function public.validate_company_branding();

-- A company's shared fields can only be changed in Company / Theme. Employee
-- updates may change personal contact details, LinkedIn, WhatsApp and photo.
create or replace function public.enforce_company_card_branding()
returns trigger language plpgsql security definer set search_path='' as $$
declare field text;
begin
    if auth.uid() is not null and exists(select 1 from public.account_settings a
        where a.user_id=new.user_id and a.account_type='company') then
        foreach field in array array['company_name','address','website_url','banner_path','card_theme',
            'custom_links','instagram_url','x_url','facebook_url','tiktok_url','github_url','telegram_url',
            'discord_url','snapchat_url','apple_wallet_url','google_wallet_url'] loop
            if (tg_op='UPDATE' and to_jsonb(new)->field is distinct from to_jsonb(old)->field)
                or (tg_op='INSERT' and coalesce(to_jsonb(new)->>field,'') not in ('','{}','[]')) then
                raise exception 'Edit shared company details and card design in Company or Theme.';
            end if;
        end loop;
    end if;
    return new;
end;
$$;
revoke all on function public.enforce_company_card_branding() from public,anon,authenticated;
drop trigger if exists enforce_company_card_branding on public.company_profiles;
create trigger enforce_company_card_branding before insert or update on public.company_profiles
    for each row execute function public.enforce_company_card_branding();

-- Keep the existing public card URL and RPC contract; derive shared fields at
-- read time so edits apply to every current and future employee immediately.
create or replace function public.get_public_company_card(requested_user_id uuid)
returns table(profile_id uuid,full_name text,job_title text,company_name text,contact_email text,
    phone text,address text,whatsapp_url text,website_url text,bio text,linkedin_url text,
    instagram_url text,x_url text,facebook_url text,tiktok_url text,github_url text,telegram_url text,
    discord_url text,snapchat_url text,apple_wallet_url text,google_wallet_url text,avatar_path text,banner_path text)
language sql stable security definer set search_path='' as $$
    select p.id,p.full_name,p.job_title,
        case when a.account_type='company' then coalesce(c.name,'') else p.company_name end,
        p.contact_email,p.phone,
        case when a.account_type='company' then c.address else p.address end,
        p.whatsapp_url,
        case when a.account_type='company' then c.website_url else p.website_url end,
        p.bio,p.linkedin_url,
        case when a.account_type='individual' then p.instagram_url end,
        case when a.account_type='individual' then p.x_url end,
        case when a.account_type='individual' then p.facebook_url end,
        case when a.account_type='individual' then p.tiktok_url end,
        case when a.account_type='individual' then p.github_url end,
        case when a.account_type='individual' then p.telegram_url end,
        case when a.account_type='individual' then p.discord_url end,
        case when a.account_type='individual' then p.snapchat_url end,
        case when a.account_type='company' then c.apple_wallet_url else p.apple_wallet_url end,
        case when a.account_type='company' then c.google_wallet_url else p.google_wallet_url end,
        p.avatar_path,
        case when a.account_type='company' then c.banner_path else p.banner_path end
    from public.company_profiles p join public.account_settings a on a.user_id=p.user_id
    left join public.company_branding c on c.user_id=p.user_id
    where p.id=requested_user_id and not p.is_locked and public.account_is_active(p.user_id)
    limit 1;
$$;
revoke all on function public.get_public_company_card(uuid) from public;
grant execute on function public.get_public_company_card(uuid) to anon,authenticated;

create or replace function public.get_public_card_appearance(requested_profile_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
    select jsonb_build_object('account_type',a.account_type,'expires_at',a.expires_at,
        'theme',case when a.account_type='company' then coalesce(c.card_theme,'{}') else p.card_theme end,
        'banner_position',case when a.account_type='company' then coalesce(c.banner_position,50) else 50 end,
        'company_links',case when a.account_type='company' then coalesce(c.custom_links,'[]') else '[]' end,
        'personal_details',jsonb_build_object('department',p.department,'alternate_name',p.alternate_name,
            'alternate_job_title',p.alternate_job_title,'secondary_phone',p.secondary_phone,'booking_url',p.booking_url))
    from public.company_profiles p join public.account_settings a on a.user_id=p.user_id
    left join public.company_branding c on c.user_id=p.user_id
    where p.id=requested_profile_id and not p.is_locked and public.account_is_active(p.user_id)
        and char_length(btrim(p.full_name))>0 limit 1;
$$;
revoke all on function public.get_public_card_appearance(uuid) from public;
grant execute on function public.get_public_card_appearance(uuid) to anon,authenticated;

commit;
