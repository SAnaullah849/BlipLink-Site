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


commit;
