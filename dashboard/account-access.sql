-- Run AFTER schema.sql in the Supabase SQL Editor. Safe to run again.
begin;

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

create table if not exists public.app_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.account_access enable row level security;
alter table public.app_admins enable row level security;
revoke all on public.account_access, public.app_admins from public, anon, authenticated;
grant select on public.account_access, public.app_admins to authenticated;
grant all on public.account_access, public.app_admins to service_role;

drop policy if exists "Users can read their account allowance" on public.account_access;
create policy "Users can read their account allowance" on public.account_access
    for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Administrators can read their membership" on public.app_admins;
create policy "Administrators can read their membership" on public.app_admins
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
-- New invitations start with one individual profile until the admin API sets access.
create or replace function public.create_company_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.account_access(user_id) values (new.id) on conflict (user_id) do nothing;
    insert into public.company_profiles(user_id, contact_email) values (new.id, new.email);
    return new;
end;
$$;
revoke all on function public.create_company_profile_for_new_user() from public, anon, authenticated;

-- Only the server service role may list accounts and their Auth email addresses.
create or replace function public.list_bliplink_accounts(requested_page integer default 1)
returns table(user_id uuid, email text, account_type text, profile_limit integer,
    profiles_used bigint, total_count bigint, is_admin boolean)
language sql stable security definer set search_path = '' as $$
    select account.user_id, users.email::text, account.account_type, account.profile_limit,
        (select count(*) from public.company_profiles as profile where profile.user_id = account.user_id),
        count(*) over (), exists(select 1 from public.app_admins as admin where admin.user_id = account.user_id)
    from public.account_access as account join auth.users as users on users.id = account.user_id
    order by users.created_at desc, account.user_id
    limit 50 offset ((greatest(1, least(coalesce(requested_page, 1), 1000000)) - 1)::bigint * 50);
$$;
revoke all on function public.list_bliplink_accounts(integer) from public, anon, authenticated;
grant execute on function public.list_bliplink_accounts(integer) to service_role;

create or replace function public.set_bliplink_administrator(requested_user_id uuid, requested_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(8627441923::bigint);
    if requested_admin is null or not exists(select 1 from auth.users where id = requested_user_id) then
        raise exception 'Choose an existing account.';
    end if;
    if requested_admin then
        insert into public.app_admins(user_id) values(requested_user_id) on conflict (user_id) do nothing;
    else
        if exists(select 1 from public.app_admins where user_id = requested_user_id)
            and (select count(*) from public.app_admins) <= 1 then
            raise exception 'The last administrator cannot be removed. Add another administrator first.';
        end if;
        delete from public.app_admins where user_id = requested_user_id;
    end if;
end;
$$;
revoke all on function public.set_bliplink_administrator(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_bliplink_administrator(uuid, boolean) to service_role;

commit;

-- Bootstrap your FIRST administrator manually (replace the email before running):
-- insert into public.app_admins(user_id)
-- select id from auth.users where lower(email) = lower('your-admin@example.com')
-- on conflict (user_id) do nothing;
