-- Supabase is the only account-management surface. Run the combined setup.sql.
begin;

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
    if not public.account_is_active(new.card_owner_id) then
        raise exception 'This card is not accepting contact exchanges.';
    end if;
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
