-- BlipLink: complete Supabase setup and upgrade. Copy this whole file into SQL Editor and Run.
-- Existing profiles, card URLs, account types, limits, and access dates are preserved.
-- Manage new and existing accounts in Table Editor > public.account_settings.
begin;
-- Source: schema.sql
-- Fail closed until account-settings.sql installs the real expiry check.
-- Use setup.sql so installation and upgrades happen together in one transaction.
create or replace function public.account_is_active(requested_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$ select false; $$;
-- Maintained component: run the combined setup.sql in Supabase SQL Editor.
-- setup.sql includes the quota, card-theme, and Supabase-only account settings.
-- Public sign-ups must remain disabled in Supabase Auth. Account options are
-- prepared in account_settings before inviting the matching email address.

create table if not exists public.company_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    full_name text not null default '' check (char_length(full_name) <= 100),
    job_title text not null default '' check (char_length(job_title) <= 100),
    company_name text not null default '' check (char_length(company_name) <= 120),
    contact_email text check (contact_email is null or char_length(contact_email) <= 254),
    phone text check (phone is null or char_length(phone) <= 40),
    address text check (address is null or char_length(address) <= 300),
    website_url text check (website_url is null or char_length(website_url) <= 500),
    custom_links jsonb not null default '[]'::jsonb check (jsonb_typeof(custom_links) = 'array'),
    whatsapp_url text check (whatsapp_url is null or char_length(whatsapp_url) <= 500),
    bio text check (bio is null or char_length(bio) <= 500),
    linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 500),
    instagram_url text check (instagram_url is null or char_length(instagram_url) <= 500),
    x_url text check (x_url is null or char_length(x_url) <= 500),
    facebook_url text check (facebook_url is null or char_length(facebook_url) <= 500),
    tiktok_url text check (tiktok_url is null or char_length(tiktok_url) <= 500),
    github_url text check (github_url is null or char_length(github_url) <= 500),
    telegram_url text check (telegram_url is null or char_length(telegram_url) <= 500),
    discord_url text check (discord_url is null or char_length(discord_url) <= 500),
    snapchat_url text check (snapchat_url is null or char_length(snapchat_url) <= 500),
    apple_wallet_url text check (apple_wallet_url is null or char_length(apple_wallet_url) <= 500),
    google_wallet_url text check (google_wallet_url is null or char_length(google_wallet_url) <= 500),
    avatar_path text,
    banner_path text,
    is_locked boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Existing cards keep their original URL (the Auth user ID); new cards get
-- independent IDs while remaining owned by the same company login.
alter table public.company_profiles add column if not exists id uuid;
update public.company_profiles set id = user_id where id is null;
alter table public.company_profiles alter column id set default gen_random_uuid();
alter table public.company_profiles alter column id set not null;
do $$
begin
    if not exists (
        select 1
        from pg_constraint as constraint_row
        join pg_attribute as column_row
          on column_row.attrelid = constraint_row.conrelid
         and column_row.attnum = any (constraint_row.conkey)
        where constraint_row.conrelid = 'public.company_profiles'::regclass
          and constraint_row.contype = 'p'
          and column_row.attname = 'id'
    ) then
        alter table public.company_profiles drop constraint if exists company_profiles_pkey;
        alter table public.company_profiles add constraint company_profiles_pkey primary key (id);
    end if;
end;
$$;
create index if not exists company_profiles_user_id_idx on public.company_profiles (user_id);

alter table public.company_profiles
    add column if not exists address text check (address is null or char_length(address) <= 300);
alter table public.company_profiles
    add column if not exists whatsapp_url text check (whatsapp_url is null or char_length(whatsapp_url) <= 500),
    add column if not exists custom_links jsonb not null default '[]'::jsonb check (jsonb_typeof(custom_links) = 'array'),
    add column if not exists apple_wallet_url text check (apple_wallet_url is null or char_length(apple_wallet_url) <= 500),
    add column if not exists google_wallet_url text check (google_wallet_url is null or char_length(google_wallet_url) <= 500),
    add column if not exists banner_path text,
    add column if not exists facebook_url text check (facebook_url is null or char_length(facebook_url) <= 500),
    add column if not exists tiktok_url text check (tiktok_url is null or char_length(tiktok_url) <= 500),
    add column if not exists github_url text check (github_url is null or char_length(github_url) <= 500),
    add column if not exists telegram_url text check (telegram_url is null or char_length(telegram_url) <= 500),
    add column if not exists discord_url text check (discord_url is null or char_length(discord_url) <= 500),
    add column if not exists snapchat_url text check (snapchat_url is null or char_length(snapchat_url) <= 500),
    add column if not exists is_locked boolean not null default false;

alter table public.company_profiles enable row level security;

revoke all on public.company_profiles from anon, authenticated, public;
grant select, insert, update on public.company_profiles to authenticated;

drop policy if exists "Company users can read their own profile" on public.company_profiles;
create policy "Company users can read their own profile"
    on public.company_profiles for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Company users can create their own profile" on public.company_profiles;
create policy "Company users can create their own profile"
    on public.company_profiles for insert to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Company users can update their own profile" on public.company_profiles;
create policy "Company users can update their own profile"
    on public.company_profiles for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create or replace function public.set_company_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists company_profiles_set_updated_at on public.company_profiles;
create trigger company_profiles_set_updated_at
    before update on public.company_profiles
    for each row execute function public.set_company_profile_updated_at();

create or replace function public.create_company_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.company_profiles (user_id, contact_email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_company_profile on auth.users;
create trigger on_auth_user_created_company_profile
    after insert on auth.users
    for each row execute function public.create_company_profile_for_new_user();

-- Backfill profiles for Auth users created before this trigger was installed.
insert into public.company_profiles (user_id, contact_email)
select users.id, users.email
from auth.users as users
where not exists (
    select 1 from public.company_profiles as profile where profile.user_id = users.id
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-photos',
    'profile-photos',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public card photos are viewable by anyone with the card link. Upload,
-- update, and delete access remains restricted by the owner-folder policies.

drop function if exists public.get_public_company_card(uuid);
create function public.get_public_company_card(requested_user_id uuid)
returns table (
    profile_id uuid,
    full_name text,
    job_title text,
    company_name text,
    contact_email text,
    phone text,
    address text,
    whatsapp_url text,
    website_url text,
    bio text,
    linkedin_url text,
    instagram_url text,
    x_url text,
    facebook_url text,
    tiktok_url text,
    github_url text,
    telegram_url text,
    discord_url text,
    snapchat_url text,
    apple_wallet_url text,
    google_wallet_url text,
    avatar_path text,
    banner_path text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        profile.id,
        profile.full_name,
        profile.job_title,
        profile.company_name,
        profile.contact_email,
        profile.phone,
        profile.address,
        profile.whatsapp_url,
        profile.website_url,
        profile.bio,
        profile.linkedin_url,
        profile.instagram_url,
        profile.x_url,
        profile.facebook_url,
        profile.tiktok_url,
        profile.github_url,
        profile.telegram_url,
        profile.discord_url,
        profile.snapchat_url,
        profile.apple_wallet_url,
        profile.google_wallet_url,
        profile.avatar_path,
        profile.banner_path
    from public.company_profiles as profile
    where profile.id = requested_user_id
      and not profile.is_locked
          and public.account_is_active(profile.user_id)
    limit 1
$$;

revoke all on function public.get_public_company_card(uuid) from public;
grant execute on function public.get_public_company_card(uuid) to anon, authenticated;

create table if not exists public.card_analytics (
    profile_id uuid primary key references public.company_profiles (id) on delete cascade,
    views bigint not null default 0 check (views >= 0),
    taps bigint not null default 0 check (taps >= 0),
    updated_at timestamptz not null default now()
);

alter table public.card_analytics enable row level security;
revoke all on public.card_analytics from anon, authenticated, public;
grant select on public.card_analytics to authenticated;

drop policy if exists "Company users can read their card analytics" on public.card_analytics;
create policy "Company users can read their card analytics"
    on public.card_analytics for select to authenticated
    using (
        exists (
            select 1 from public.company_profiles as profile
            where profile.id = card_analytics.profile_id
              and profile.user_id = (select auth.uid())
        )
    );

create table if not exists public.card_analytics_daily (
    profile_id uuid not null references public.company_profiles (id) on delete cascade,
    event_date date not null,
    views bigint not null default 0 check (views >= 0),
    taps bigint not null default 0 check (taps >= 0),
    updated_at timestamptz not null default now(),
    primary key (profile_id, event_date)
);

alter table public.card_analytics_daily enable row level security;
revoke all on public.card_analytics_daily from anon, authenticated, public;
grant select on public.card_analytics_daily to authenticated;

drop policy if exists "Company users can read their daily card analytics" on public.card_analytics_daily;
create policy "Company users can read their daily card analytics"
    on public.card_analytics_daily for select to authenticated
    using (
        exists (
            select 1 from public.company_profiles as profile
            where profile.id = card_analytics_daily.profile_id
              and profile.user_id = (select auth.uid())
        )
    );

drop function if exists public.record_public_card_event(uuid, text);

create table if not exists public.card_country_analytics (
profile_id uuid not null references public.company_profiles (id) on delete cascade,
country_code text not null check (country_code ~ '^[A-Z]{2}$'),
views bigint not null default 0 check (views >= 0),
taps bigint not null default 0 check (taps >= 0),
updated_at timestamptz not null default now(),
primary key (profile_id, country_code)
);

alter table public.card_country_analytics enable row level security;
revoke all on public.card_country_analytics from anon, authenticated, public;
grant select on public.card_country_analytics to authenticated;

drop policy if exists "Company users can read their country analytics" on public.card_country_analytics;
create policy "Company users can read their country analytics"
on public.card_country_analytics for select to authenticated
using (
    exists (
        select 1 from public.company_profiles as profile
        where profile.id = card_country_analytics.profile_id
          and profile.user_id = (select auth.uid())
    )
);

create table if not exists public.card_city_analytics (
profile_id uuid not null references public.company_profiles (id) on delete cascade,
city_name text not null check (char_length(city_name) between 1 and 100),
country_code text not null check (country_code ~ '^[A-Z]{2}$'),
views bigint not null default 0 check (views >= 0),
taps bigint not null default 0 check (taps >= 0),
updated_at timestamptz not null default now(),
primary key (profile_id, city_name, country_code)
);

alter table public.card_city_analytics enable row level security;
revoke all on public.card_city_analytics from anon, authenticated, public;
grant select on public.card_city_analytics to authenticated;

drop policy if exists "Company users can read their city analytics" on public.card_city_analytics;
create policy "Company users can read their city analytics"
on public.card_city_analytics for select to authenticated
using (
    exists (
        select 1 from public.company_profiles as profile
        where profile.id = card_city_analytics.profile_id
          and profile.user_id = (select auth.uid())
    )
);

do $$
declare
target_table text;
begin
if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target_table in array array['card_analytics', 'card_analytics_daily', 'card_country_analytics', 'card_city_analytics'] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = target_table
        ) then
            execute format('alter publication supabase_realtime add table public.%I', target_table);
        end if;
    end loop;
end if;
end;
$$;

create table if not exists public.company_subscriptions (
user_id uuid primary key references auth.users (id) on delete cascade,
status text not null default 'inactive' check (status in ('active', 'inactive')),
price numeric(8, 2) not null default 6.99 check (price = 6.99),
currency text not null default 'USD' check (currency = 'USD'),
starts_at timestamptz,
expires_at timestamptz,
updated_at timestamptz not null default now(),
check (
    (status = 'inactive' and starts_at is null and expires_at is null)
    or (status = 'active' and starts_at is not null and expires_at > starts_at)
)
);

alter table public.company_subscriptions
    add column if not exists status text not null default 'inactive',
    add column if not exists price numeric(8, 2) not null default 6.99,
    add column if not exists currency text not null default 'USD',
    add column if not exists starts_at timestamptz,
    add column if not exists expires_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

insert into public.company_subscriptions (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.company_subscriptions enable row level security;
revoke all on public.company_subscriptions from anon, authenticated, public;
grant select on public.company_subscriptions to authenticated;

drop policy if exists "Company users can read their subscription" on public.company_subscriptions;
create policy "Company users can read their subscription"
on public.company_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.create_company_subscription_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
insert into public.company_subscriptions (user_id)
values (new.id)
on conflict (user_id) do nothing;
return new;
end;
$$;

drop trigger if exists on_auth_user_created_company_subscription on auth.users;
create trigger on_auth_user_created_company_subscription
after insert on auth.users
for each row execute function public.create_company_subscription_for_new_user();

create or replace function public.delete_company_profile(requested_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
profile_owner uuid;
profile_count integer;
begin
select user_id into profile_owner
from public.company_profiles
where id = requested_profile_id;

if profile_owner is distinct from (select auth.uid()) then
    raise exception 'Profile not found or access denied.';
end if;

perform id
from public.company_profiles
where user_id = profile_owner
for update;

select count(*) into profile_count
from public.company_profiles
where user_id = profile_owner;

if profile_count <= 1 then
    raise exception 'At least one company profile must remain.';
end if;

delete from public.company_profiles where id = requested_profile_id;
end;
$$;

revoke all on function public.delete_company_profile(uuid) from public, anon;
grant execute on function public.delete_company_profile(uuid) to authenticated;

drop function if exists public.record_public_card_event(uuid, text, text);
create or replace function public.record_public_card_event(
    requested_profile_id uuid,
    requested_event_type text,
    requested_country_code text,
    requested_city_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if requested_event_type not in ('view', 'tap') then
        raise exception 'Unsupported card analytics event.';
    end if;
    if requested_country_code is not null and requested_country_code !~ '^[A-Z]{2}$' then
        raise exception 'Country must be a two-letter ISO code.';
    end if;
    if requested_city_name is not null and (
        char_length(btrim(requested_city_name)) not between 1 and 100
        or requested_city_name ~ '[[:cntrl:]]'
    ) then
        raise exception 'City name is invalid.';
    end if;
    if not exists (
        select 1 from public.company_profiles as profile
        where profile.id = requested_profile_id
          and char_length(btrim(profile.full_name)) > 0
          and not profile.is_locked
          and public.account_is_active(profile.user_id)
    ) then
        raise exception 'This business card is unavailable.';
    end if;
    insert into public.card_analytics (profile_id, views, taps)
    values (
        requested_profile_id,
        case when requested_event_type = 'view' then 1 else 0 end,
        case when requested_event_type = 'tap' then 1 else 0 end
    )
    on conflict (profile_id) do update set
        views = public.card_analytics.views + excluded.views,
        taps = public.card_analytics.taps + excluded.taps,
        updated_at = now();
    insert into public.card_analytics_daily (profile_id, event_date, views, taps)
    values (
        requested_profile_id,
        (now() at time zone 'UTC')::date,
        case when requested_event_type = 'view' then 1 else 0 end,
        case when requested_event_type = 'tap' then 1 else 0 end
    )
    on conflict (profile_id, event_date) do update set
        views = public.card_analytics_daily.views + excluded.views,
        taps = public.card_analytics_daily.taps + excluded.taps,
        updated_at = now();
    if requested_country_code is not null then
        insert into public.card_country_analytics (profile_id, country_code, views, taps)
        values (
            requested_profile_id,
            requested_country_code,
            case when requested_event_type = 'view' then 1 else 0 end,
            case when requested_event_type = 'tap' then 1 else 0 end
        )
        on conflict (profile_id, country_code) do update set
            views = public.card_country_analytics.views + excluded.views,
            taps = public.card_country_analytics.taps + excluded.taps,
            updated_at = now();
    end if;
    if requested_city_name is not null and requested_country_code is not null then
        insert into public.card_city_analytics (profile_id, city_name, country_code, views, taps)
        values (
            requested_profile_id,
            btrim(requested_city_name),
            requested_country_code,
            case when requested_event_type = 'view' then 1 else 0 end,
            case when requested_event_type = 'tap' then 1 else 0 end
        )
        on conflict (profile_id, city_name, country_code) do update set
            views = public.card_city_analytics.views + excluded.views,
            taps = public.card_city_analytics.taps + excluded.taps,
            updated_at = now();
    end if;
end;
$$;

revoke all on function public.record_public_card_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_public_card_event(uuid, text, text, text) to service_role;

create or replace function public.get_company_card_analytics()
returns table (profile_id uuid, full_name text, views bigint, taps bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        profile.id,
        profile.full_name,
        coalesce(analytics.views, 0),
        coalesce(analytics.taps, 0)
    from public.company_profiles as profile
    left join public.card_analytics as analytics on analytics.profile_id = profile.id
    where profile.user_id = (select auth.uid())
    order by profile.full_name
$$;

revoke all on function public.get_company_card_analytics() from public;
grant execute on function public.get_company_card_analytics() to authenticated;

create table if not exists public.card_contact_exchanges (
    id bigint generated by default as identity primary key,
    card_owner_id uuid not null references auth.users (id) on delete cascade,
    profile_id uuid references public.company_profiles (id) on delete set null,
    visitor_name text not null check (char_length(visitor_name) between 1 and 100),
    visitor_phone text not null check (char_length(visitor_phone) between 3 and 40),
    visitor_email text check (visitor_email is null or char_length(visitor_email) <= 254),
    visitor_company text check (visitor_company is null or char_length(visitor_company) <= 120),
    visitor_role text check (visitor_role is null or char_length(visitor_role) <= 120),
    visitor_services text[] not null default '{}',
    visitor_message text check (visitor_message is null or char_length(visitor_message) <= 1000),
    consented_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'card_contact_exchanges'
       ) then
        alter publication supabase_realtime add table public.card_contact_exchanges;
    end if;
end;
$$;

alter table public.card_contact_exchanges
    add column if not exists profile_id uuid references public.company_profiles (id) on delete set null,
    add column if not exists visitor_services text[] not null default '{}';
update public.card_contact_exchanges as exchange
set profile_id = profile.id
from public.company_profiles as profile
where exchange.profile_id is null
  and profile.user_id = exchange.card_owner_id
  and profile.id = profile.user_id;
create index if not exists card_contact_exchanges_owner_created_idx
    on public.card_contact_exchanges (card_owner_id, created_at desc);

alter table public.card_contact_exchanges enable row level security;
revoke all on public.card_contact_exchanges from anon, public;
grant select on public.card_contact_exchanges to authenticated;

drop policy if exists "Card owners can read their contact exchanges" on public.card_contact_exchanges;
create policy "Card owners can read their contact exchanges"
    on public.card_contact_exchanges for select to authenticated
    using ((select auth.uid()) = card_owner_id);

create or replace function public.get_company_dashboard_stats()
returns table (
    profile_id uuid,
    full_name text,
    views bigint,
    taps bigint,
    leads bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        profile.id,
        profile.full_name,
        coalesce(analytics.views, 0),
        coalesce(analytics.taps, 0),
        (
            select count(*)
            from public.card_contact_exchanges as exchange
            where exchange.profile_id = profile.id
              and exchange.card_owner_id = (select auth.uid())
        )
    from public.company_profiles as profile
    left join public.card_analytics as analytics on analytics.profile_id = profile.id
    where profile.user_id = (select auth.uid())
    order by profile.full_name
$$;

revoke all on function public.get_company_dashboard_stats() from public;
grant execute on function public.get_company_dashboard_stats() to authenticated;

create or replace function public.get_company_analytics_timeseries(
    requested_profile_id uuid,
    requested_start_date date,
    requested_end_date date
)
returns table (
    event_date date,
    views bigint,
    taps bigint,
    leads bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if requested_start_date is null or requested_end_date is null
       or requested_end_date < requested_start_date
       or requested_end_date - requested_start_date > 365 then
        raise exception 'Choose a valid date range of 366 days or less.';
    end if;

    return query
    with owned_profiles as (
        select profile.id
        from public.company_profiles as profile
        where profile.user_id = (select auth.uid())
          and (requested_profile_id is null or profile.id = requested_profile_id)
    ),
    date_range as (
        select days.generated_day::date as day
        from generate_series(
            requested_start_date::timestamp,
            requested_end_date::timestamp,
            interval '1 day'
        ) as days(generated_day)
    ),
    daily_events as (
        select daily.event_date, sum(daily.views)::bigint as views, sum(daily.taps)::bigint as taps
        from public.card_analytics_daily as daily
        join owned_profiles on owned_profiles.id = daily.profile_id
        where daily.event_date between requested_start_date and requested_end_date
        group by daily.event_date
    ),
    daily_leads as (
        select (exchange.created_at at time zone 'UTC')::date as day, count(*)::bigint as leads
        from public.card_contact_exchanges as exchange
        join owned_profiles on owned_profiles.id = exchange.profile_id
        where exchange.created_at >= requested_start_date::timestamp at time zone 'UTC'
          and exchange.created_at < (requested_end_date + 1)::timestamp at time zone 'UTC'
        group by (exchange.created_at at time zone 'UTC')::date
    )
    select
        date_range.day,
        coalesce(daily_events.views, 0),
        coalesce(daily_events.taps, 0),
        coalesce(daily_leads.leads, 0)
    from date_range
    left join daily_events on daily_events.event_date = date_range.day
    left join daily_leads on daily_leads.day = date_range.day
    order by date_range.day;
end;
$$;

revoke all on function public.get_company_analytics_timeseries(uuid, date, date) from public;
grant execute on function public.get_company_analytics_timeseries(uuid, date, date) to authenticated;

create or replace function public.get_company_location_summary(requested_profile_id uuid)
returns table (top_city text, total_locations bigint, total_visits bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    with owned_profiles as (
        select profile.id
        from public.company_profiles as profile
        where profile.user_id = (select auth.uid())
          and (requested_profile_id is null or profile.id = requested_profile_id)
    ),
    cities as (
        select
            locations.city_name,
            locations.country_code,
            sum(locations.views)::bigint as views
        from public.card_city_analytics as locations
        join owned_profiles on owned_profiles.id = locations.profile_id
        group by locations.city_name, locations.country_code
    )
    select
        (select city_name || ', ' || country_code from cities order by views desc, city_name limit 1),
        (select count(*) from cities),
        coalesce((select sum(views) from cities), 0)::bigint
$$;

revoke all on function public.get_company_location_summary(uuid) from public;
grant execute on function public.get_company_location_summary(uuid) to authenticated;

drop function if exists public.submit_public_card_exchange(uuid, text, text, text, text, text, text, boolean);
drop function if exists public.submit_public_card_exchange(uuid, text, text, text, text, text[], text, boolean);
create function public.submit_public_card_exchange(
    requested_profile_id uuid,
    submitted_name text,
    submitted_phone text,
    submitted_email text,
    submitted_company text,
    submitted_services text[],
    submitted_message text,
    submitted_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    resolved_card_owner_id uuid;
begin
    if submitted_name is null or char_length(btrim(submitted_name)) not between 1 and 100 then
        raise exception 'A name between 1 and 100 characters is required.';
    end if;
    if submitted_phone is null or char_length(btrim(submitted_phone)) not between 3 and 40 then
        raise exception 'A phone number between 3 and 40 characters is required.';
    end if;
    if submitted_email is not null and char_length(submitted_email) > 254 then
        raise exception 'Email address is too long.';
    end if;
    if submitted_company is not null and char_length(submitted_company) > 120 then
        raise exception 'Company name is too long.';
    end if;
    if cardinality(coalesce(submitted_services, array[]::text[])) > 12 then
        raise exception 'Interested services are too long.';
    end if;
    if exists (
        select 1
        from unnest(coalesce(submitted_services, array[]::text[])) as selected_service(value)
        where selected_service.value is null
           or char_length(btrim(selected_service.value)) > 500
    ) then
        raise exception 'One or more selected services are invalid.';
    end if;
    if submitted_message is not null and char_length(submitted_message) > 1000 then
        raise exception 'Message is too long.';
    end if;
    if submitted_consent is distinct from true then
        raise exception 'Consent is required to share contact details.';
    end if;
    if not exists (
        select 1
        from public.company_profiles as profile
        where profile.id = requested_profile_id
          and char_length(btrim(profile.full_name)) > 0
          and not profile.is_locked
          and public.account_is_active(profile.user_id)
    ) then
        raise exception 'This business card is unavailable.';
    end if;

    select profile.user_id into resolved_card_owner_id
    from public.company_profiles as profile
    where profile.id = requested_profile_id;

    insert into public.card_contact_exchanges (
        card_owner_id,
        profile_id,
        visitor_name,
        visitor_phone,
        visitor_email,
        visitor_company,
        visitor_services,
        visitor_message
    )
    values (
        resolved_card_owner_id,
        requested_profile_id,
        btrim(submitted_name),
        btrim(submitted_phone),
        nullif(btrim(submitted_email), ''),
        nullif(btrim(submitted_company), ''),
        coalesce((
            select array_agg(distinct selected_service.value order by selected_service.value)
            from unnest(coalesce(submitted_services, array[]::text[])) as selected_service(value)
        ), array[]::text[]),
        nullif(btrim(submitted_message), '')
    );
end;
$$;

revoke all on function public.submit_public_card_exchange(uuid, text, text, text, text, text[], text, boolean) from public;
grant execute on function public.submit_public_card_exchange(uuid, text, text, text, text, text[], text, boolean) to anon, authenticated;

create table if not exists public.crm_leads (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    source_exchange_id bigint unique references public.card_contact_exchanges (id) on delete set null,
    full_name text not null check (char_length(full_name) between 1 and 100),
    phone text check (phone is null or char_length(phone) <= 40),
    email text check (email is null or char_length(email) <= 254),
    company text check (company is null or char_length(company) <= 120),
    role text check (role is null or char_length(role) <= 120),
    message text check (message is null or char_length(message) <= 1000),
    status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'won', 'lost')),
    notes text not null default '' check (char_length(notes) <= 4000),
    follow_up_at date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.crm_leads
    add column if not exists services text[] not null default '{}';

create index if not exists crm_leads_owner_updated_idx
    on public.crm_leads (owner_id, updated_at desc);

alter table public.crm_leads enable row level security;
revoke all on public.crm_leads from anon, public;
grant select, insert, update, delete on public.crm_leads to authenticated;

drop policy if exists "Company users can manage their CRM leads" on public.crm_leads;
create policy "Company users can manage their CRM leads"
    on public.crm_leads for all to authenticated
    using ((select auth.uid()) = owner_id)
    with check (
        (select auth.uid()) = owner_id
        and (
            source_exchange_id is null
            or exists (
                select 1
                from public.card_contact_exchanges as exchange
                where exchange.id = source_exchange_id
                  and exchange.card_owner_id = (select auth.uid())
            )
        )
    );

drop trigger if exists crm_leads_set_updated_at on public.crm_leads;
create trigger crm_leads_set_updated_at
    before update on public.crm_leads
    for each row execute function public.set_company_profile_updated_at();

drop policy if exists "Company users can read their own profile photos" on storage.objects;
create policy "Company users can read their own profile photos"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "Company users can upload their own profile photos" on storage.objects;
create policy "Company users can upload their own profile photos"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "Company users can update their own profile photos" on storage.objects;
create policy "Company users can update their own profile photos"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "Company users can delete their own profile photos" on storage.objects;
create policy "Company users can delete their own profile photos"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );


-- Source: account-access.sql
-- Run AFTER schema.sql in the Supabase SQL Editor. Safe to run again.

create table if not exists public.account_access (
    user_id uuid primary key references auth.users(id) on delete cascade,
    account_type text not null default 'individual' check (account_type in ('individual', 'company')),
    profile_limit integer not null default 1 check (profile_limit between 1 and 100000),
    updated_at timestamptz not null default now(),
    check (account_type = 'company' or profile_limit = 1)
);

-- Keep existing accounts as companies, with enough capacity for every existing card.
insert into public.account_access (user_id, account_type, profile_limit)
select users.id, 'company', greatest(count(profile.id), 1)::integer
from auth.users as users
left join public.company_profiles as profile on profile.user_id = users.id
group by users.id
on conflict (user_id) do nothing;

alter table public.account_access enable row level security;
revoke all on public.account_access from public, anon, authenticated;
grant select on public.account_access to authenticated;
grant all on public.account_access to service_role;
drop policy if exists "Users can read their account allowance" on public.account_access;
create policy "Users can read their account allowance" on public.account_access
    for select to authenticated using (user_id = (select auth.uid()));
-- This row lock serializes profile creation with quota changes for the same owner.
-- A simultaneous request cannot create an extra profile beyond the allowance.
create or replace function public.enforce_profile_allowance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    allowed_profiles integer;
    existing_profiles bigint;
begin
    if tg_op = 'UPDATE' then
        if new.user_id is distinct from old.user_id then
            raise exception 'Profile ownership cannot be changed.';
        end if;
        return new;
    end if;
    select profile_limit into allowed_profiles
    from public.account_access where user_id = new.user_id for update;
    if not found then
        raise exception 'Account allowance is not configured. Contact your administrator.';
    end if;
    select count(*) into existing_profiles from public.company_profiles where user_id = new.user_id;
    if existing_profiles >= allowed_profiles then
        raise exception 'Profile limit reached (%). Contact your administrator to increase your allowance.', allowed_profiles;
    end if;
    return new;
end;
$$;
revoke all on function public.enforce_profile_allowance() from public, anon, authenticated;
drop trigger if exists company_profiles_enforce_allowance on public.company_profiles;
create trigger company_profiles_enforce_allowance before insert or update of user_id
    on public.company_profiles for each row execute function public.enforce_profile_allowance();

create or replace function public.validate_account_allowance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare existing_profiles bigint;
begin
    if new.user_id is distinct from old.user_id then
        raise exception 'Account ownership cannot be changed.';
    end if;
    select count(*) into existing_profiles from public.company_profiles where user_id = new.user_id;
    if new.profile_limit < existing_profiles then
        raise exception 'This account already has % profiles. Remove extra profiles before reducing its allowance.', existing_profiles;
    end if;
    new.updated_at = now();
    return new;
end;
$$;
revoke all on function public.validate_account_allowance() from public, anon, authenticated;
drop trigger if exists account_access_validate_allowance on public.account_access;
create trigger account_access_validate_allowance before update on public.account_access
    for each row execute function public.validate_account_allowance();

-- Ignore user-editable Auth metadata for account type, limits, and admin rights.
-- account-settings.sql installs the final invitation provisioning workflow.
create or replace function public.create_company_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.account_access(user_id) values (new.id) on conflict (user_id) do nothing;
    insert into public.company_profiles(user_id, contact_email) values (new.id, new.email);
    return new;
end;
$$;
revoke all on function public.create_company_profile_for_new_user() from public, anon, authenticated;




-- Source: card-themes.sql
-- Run once (or again safely) AFTER schema.sql and account-access.sql.

alter table public.company_profiles add column if not exists card_theme jsonb not null default '{}'
    check (jsonb_typeof(card_theme) = 'object' and octet_length(card_theme::text) <= 8192);

-- Keep the existing public card RPC and card URLs compatible with older clients.
create or replace function public.get_public_card_appearance(requested_profile_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('theme', profile.card_theme, 'account_type', account.account_type, 'expires_at', subscription.expires_at)
    from public.company_profiles as profile
    join public.account_access as account on account.user_id = profile.user_id
    left join public.company_subscriptions as subscription on subscription.user_id = profile.user_id
    where profile.id = requested_profile_id and not profile.is_locked
      and public.account_is_active(profile.user_id)
      and char_length(btrim(profile.full_name)) > 0
    limit 1;
$$;
revoke all on function public.get_public_card_appearance(uuid) from public;
grant execute on function public.get_public_card_appearance(uuid) to anon, authenticated;

-- Individuals have a card editor, without access to the company CRM.
drop policy if exists "Company users can manage their CRM leads" on public.crm_leads;
create policy "Company users can manage their CRM leads"
    on public.crm_leads for all to authenticated
    using (
        owner_id = (select auth.uid())
        and public.account_is_active(owner_id)
        and exists(select 1 from public.account_access as account
            where account.user_id = (select auth.uid()) and account.account_type = 'company')
    )
    with check (
        owner_id = (select auth.uid())
        and public.account_is_active(owner_id)
        and exists(select 1 from public.account_access as account
            where account.user_id = (select auth.uid()) and account.account_type = 'company')
        and (source_exchange_id is null or exists(
            select 1 from public.card_contact_exchanges as exchange
            where exchange.id = source_exchange_id and exchange.card_owner_id = (select auth.uid())
        ))
    );



-- Source: account-settings.sql
-- Supabase is the only account-management surface. Run the combined setup.sql.

do $$ begin
    create type public.bliplink_account_type as enum ('individual', 'company');
exception when duplicate_object then null; end $$;
do $$ begin
    create type public.bliplink_access_period as enum ('monthly', 'yearly');
exception when duplicate_object then null; end $$;
do $$ begin
    create type public.bliplink_access_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

create table if not exists public.account_settings (
    email text primary key,
    user_id uuid unique references auth.users(id) on delete cascade,
    account_type public.bliplink_account_type not null default 'individual',
    profile_limit integer not null default 1 check (profile_limit between 1 and 100000),
    access_period public.bliplink_access_period not null default 'yearly',
    access_status public.bliplink_access_status not null default 'active',
    starts_at timestamptz,
    expires_at timestamptz,
    notes text not null default '' check (char_length(notes) <= 1000),
    updated_at timestamptz not null default now(),
    check (account_type = 'company' or profile_limit = 1),
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    check (expires_at is null or (starts_at is not null and expires_at > starts_at))
);

comment on table public.account_settings is 'Manage accounts here: prepare an email and its options, then invite that email in Authentication. Existing accounts can be edited here too.';
comment on column public.account_settings.email is 'Enter the same email you will invite in Authentication. It is normalized to lowercase.';
comment on column public.account_settings.user_id is 'Automatic: leave empty. Linked when the matching Auth user is created.';
comment on column public.account_settings.account_type is 'Individual = exactly one card. Company = profile allowance you choose.';
comment on column public.account_settings.profile_limit is 'Total profiles, including the first card. Individuals always have one.';
comment on column public.account_settings.access_period is 'Monthly or yearly access. No automatic payment collection.';
comment on column public.account_settings.access_status is 'Active enables the selected period; inactive pauses editing and hides all public cards.';
comment on column public.account_settings.starts_at is 'Optional. Leave empty to start when the user is invited. To restart a period later, set a new start date.';
comment on column public.account_settings.expires_at is 'Automatic: one month or year after starts_at. An explicit custom expiry may be entered.';

alter table public.account_settings enable row level security;
revoke all on public.account_settings from public, anon, authenticated;
grant select(email, user_id, account_type, profile_limit, access_period, access_status, starts_at, expires_at, updated_at)
    on public.account_settings to authenticated;
grant all on public.account_settings to service_role;
drop policy if exists "Users can read their own access settings" on public.account_settings;
create policy "Users can read their own access settings" on public.account_settings
    for select to authenticated using (user_id = (select auth.uid()));

-- Preserve existing type, limits, subscription status, dates, profiles, and URLs.
insert into public.account_settings(email, user_id, account_type, profile_limit, access_period, access_status, starts_at, expires_at)
select coalesce(lower(nullif(users.email, '')), users.id::text || '@unassigned.invalid'), users.id,
    access.account_type::public.bliplink_account_type, access.profile_limit,
    case when subscription.expires_at - subscription.starts_at <= interval '40 days' then 'monthly' else 'yearly' end::public.bliplink_access_period,
    coalesce(subscription.status, 'inactive')::public.bliplink_access_status,
    subscription.starts_at, subscription.expires_at
from auth.users as users
join public.account_access as access on access.user_id = users.id
left join public.company_subscriptions as subscription on subscription.user_id = users.id
on conflict (email) do nothing;

create or replace function public.normalize_account_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked_email text; used_profiles bigint;
begin
    new.email = lower(btrim(new.email));
    if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is distinct from old.user_id then
        raise exception 'An existing account cannot be reassigned to another user.';
    end if;
    if new.user_id is null then
        select id into new.user_id from auth.users where lower(email) = new.email;
    end if;
    if new.user_id is not null then
        select lower(email) into linked_email from auth.users where id = new.user_id;
        if linked_email is distinct from new.email then
            raise exception 'Use the email belonging to this Auth user. Change a login email in Authentication first.';
        end if;
    end if;
    if new.account_type = 'individual' then new.profile_limit = 1; end if;
    select count(*) into used_profiles from public.company_profiles where user_id = new.user_id;
    if used_profiles > new.profile_limit then
        raise exception 'This user already has % profiles. Remove extra profiles before lowering the allowance or choosing individual.', used_profiles;
    end if;
    if new.access_status = 'active' and new.user_id is not null then
        if tg_op = 'UPDATE' and old.access_status = 'inactive' and new.starts_at is not distinct from old.starts_at then
            new.starts_at = now();
        end if;
        new.starts_at = coalesce(new.starts_at, now());
        if new.expires_at is null or (tg_op = 'UPDATE' and
            (new.starts_at is distinct from old.starts_at or new.access_period is distinct from old.access_period)
            and new.expires_at is not distinct from old.expires_at) then
            new.expires_at = new.starts_at + case when new.access_period = 'monthly' then interval '1 month' else interval '1 year' end;
        end if;
    end if;
    new.updated_at = now();
    return new;
end;
$$;
revoke all on function public.normalize_account_settings() from public, anon, authenticated;
drop trigger if exists account_settings_normalize on public.account_settings;
create trigger account_settings_normalize before insert or update on public.account_settings
    for each row execute function public.normalize_account_settings();

-- Legacy tables are implementation details. The single setup table is authoritative.
create or replace function public.sync_account_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.user_id is not null then
        insert into public.account_access(user_id, account_type, profile_limit)
        values(new.user_id, new.account_type::text, new.profile_limit)
        on conflict(user_id) do update set account_type = excluded.account_type, profile_limit = excluded.profile_limit;
        insert into public.company_subscriptions(user_id, status, starts_at, expires_at)
        values(new.user_id, new.access_status::text,
            case when new.access_status = 'active' then new.starts_at else null end,
            case when new.access_status = 'active' then new.expires_at else null end)
        on conflict(user_id) do update set status = excluded.status,
            starts_at = excluded.starts_at, expires_at = excluded.expires_at, updated_at = now();
    end if;
    return new;
end;
$$;
revoke all on function public.sync_account_settings() from public, anon, authenticated;
drop trigger if exists account_settings_sync on public.account_settings;
create trigger account_settings_sync after insert or update on public.account_settings
    for each row execute function public.sync_account_settings();

create or replace function public.create_company_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    -- Metadata is user-editable and deliberately grants no type, quota, or access.
    insert into public.account_settings(email, access_status)
    values(lower(new.email), 'inactive') on conflict(email) do nothing;
    update public.account_settings set user_id = new.id where email = lower(new.email);
    insert into public.company_profiles(user_id, contact_email) values(new.id, new.email);
    return new;
end;
$$;
revoke all on function public.create_company_profile_for_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_company_profile on auth.users;
create trigger on_auth_user_created_company_profile after insert on auth.users
    for each row execute function public.create_company_profile_for_new_user();
drop trigger if exists on_auth_user_created_company_subscription on auth.users;

create or replace function public.sync_account_login_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    update public.account_settings set email = lower(new.email) where user_id = new.id;
    return new;
end;
$$;
revoke all on function public.sync_account_login_email() from public, anon, authenticated;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
    for each row when (old.email is distinct from new.email) execute function public.sync_account_login_email();

create or replace function public.account_is_active(requested_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists(select 1 from public.account_settings where user_id = requested_user_id
        and access_status = 'active' and starts_at <= now() and expires_at > now());
$$;
revoke all on function public.account_is_active(uuid) from public, anon;
grant execute on function public.account_is_active(uuid) to authenticated, service_role;

create or replace function public.get_my_account_access()
returns table(account_type text, profile_limit integer, access_period text, access_status text,
    starts_at timestamptz, expires_at timestamptz, effective_status text, can_edit boolean)
language sql stable security definer set search_path = '' as $$
    select account.account_type::text, account.profile_limit, account.access_period::text, account.access_status::text,
        account.starts_at, account.expires_at,
        case when account.access_status <> 'active' or account.starts_at is null or account.expires_at is null then 'inactive'
            when account.starts_at > now() then 'scheduled' when account.expires_at <= now() then 'expired' else 'active' end,
        public.account_is_active(account.user_id)
    from public.account_settings as account where account.user_id = (select auth.uid());
$$;
revoke all on function public.get_my_account_access() from public, anon;
grant execute on function public.get_my_account_access() to authenticated;

-- Call only from SQL Editor/service role: select public.renew_account_access('email@example.com');
create or replace function public.renew_account_access(account_email text, periods integer default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare account public.account_settings%rowtype; renewal_start timestamptz;
begin
    if periods is null or periods not between 1 and 120 then raise exception 'Choose between 1 and 120 periods.'; end if;
    select * into account from public.account_settings where email = lower(btrim(account_email)) for update;
    if not found or account.user_id is null then raise exception 'Invite this email before renewing its access.'; end if;
    renewal_start = greatest(now(), case when account.access_status = 'active' then account.expires_at else now() end);
    update public.account_settings set access_status = 'active', starts_at = case
        when account.access_status = 'active' and account.expires_at > now() then account.starts_at else now() end,
        expires_at = renewal_start + case when account.access_period = 'monthly' then interval '1 month' else interval '1 year' end * periods
    where email = account.email;
end;
$$;
revoke all on function public.renew_account_access(text, integer) from public, anon, authenticated;
grant execute on function public.renew_account_access(text, integer) to service_role;

create or replace function public.enforce_active_profile_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if (select auth.uid()) = old.user_id and not public.account_is_active(old.user_id) then
        raise exception 'Your account access has ended. Contact support to renew it.';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;
revoke all on function public.enforce_active_profile_edit() from public, anon, authenticated;
drop trigger if exists company_profiles_active_edit on public.company_profiles;
create trigger company_profiles_active_edit before update or delete on public.company_profiles
    for each row execute function public.enforce_active_profile_edit();

create or replace function public.enforce_active_contact_exchange()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if not public.account_is_active(new.card_owner_id) or not exists(
        select 1 from public.account_settings where user_id = new.card_owner_id and account_type = 'company'
    ) then raise exception 'This card is not accepting contact exchanges.'; end if;
    return new;
end;
$$;
revoke all on function public.enforce_active_contact_exchange() from public, anon, authenticated;
drop trigger if exists contact_exchanges_active_account on public.card_contact_exchanges;
create trigger contact_exchanges_active_account before insert on public.card_contact_exchanges
    for each row execute function public.enforce_active_contact_exchange();

drop policy if exists "Company users can upload their own profile photos" on storage.objects;
create policy "Company users can upload their own profile photos" on storage.objects
    for insert to authenticated with check (bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text and public.account_is_active((select auth.uid())));
drop policy if exists "Company users can update their own profile photos" on storage.objects;
create policy "Company users can update their own profile photos" on storage.objects
    for update to authenticated using (bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text and public.account_is_active((select auth.uid())))
    with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
        and public.account_is_active((select auth.uid())));
drop policy if exists "Company users can delete their own profile photos" on storage.objects;
create policy "Company users can delete their own profile photos" on storage.objects
    for delete to authenticated using (bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text and public.account_is_active((select auth.uid())));

create or replace function public.enforce_profile_allowance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare allowance integer; used_profiles bigint;
begin
    if tg_op = 'UPDATE' then
        if new.user_id is distinct from old.user_id then raise exception 'Profile ownership cannot be changed.'; end if;
        return new;
    end if;
    select profile_limit into allowance from public.account_access where user_id = new.user_id for update;
    if not found then raise exception 'Account allowance is not configured. Contact support.'; end if;
    select count(*) into used_profiles from public.company_profiles where user_id = new.user_id;
    if used_profiles >= allowance then raise exception 'Profile limit reached (%). Contact support.', allowance; end if;
    if used_profiles > 0 and not public.account_is_active(new.user_id) then
        raise exception 'Your account access has ended. Contact support to renew it.';
    end if;
    return new;
end;
$$;

drop function if exists public.list_bliplink_accounts(integer);
drop function if exists public.set_bliplink_administrator(uuid, boolean);
drop table if exists public.app_admins;
commit;
