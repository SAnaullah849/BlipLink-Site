-- Run this file in the Supabase SQL Editor before using the company dashboard.
-- Create company accounts manually in Supabase Authentication. Public sign-ups
-- must remain disabled in the Supabase Auth settings.

create table if not exists public.company_profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    full_name text not null default '' check (char_length(full_name) <= 100),
    job_title text not null default '' check (char_length(job_title) <= 100),
    company_name text not null default '' check (char_length(company_name) <= 120),
    contact_email text check (contact_email is null or char_length(contact_email) <= 254),
    phone text check (phone is null or char_length(phone) <= 40),
    address text check (address is null or char_length(address) <= 300),
    website_url text check (website_url is null or char_length(website_url) <= 500),
    bio text check (bio is null or char_length(bio) <= 500),
    linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 500),
    instagram_url text check (instagram_url is null or char_length(instagram_url) <= 500),
    x_url text check (x_url is null or char_length(x_url) <= 500),
    avatar_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.company_profiles
    add column if not exists address text check (address is null or char_length(address) <= 300);

alter table public.company_profiles enable row level security;

revoke all on public.company_profiles from anon;
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
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_company_profile on auth.users;
create trigger on_auth_user_created_company_profile
    after insert on auth.users
    for each row execute function public.create_company_profile_for_new_user();

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
    full_name text,
    job_title text,
    company_name text,
    contact_email text,
    phone text,
    address text,
    website_url text,
    bio text,
    linkedin_url text,
    instagram_url text,
    x_url text,
    avatar_path text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        profile.full_name,
        profile.job_title,
        profile.company_name,
        profile.contact_email,
        profile.phone,
        profile.address,
        profile.website_url,
        profile.bio,
        profile.linkedin_url,
        profile.instagram_url,
        profile.x_url,
        profile.avatar_path
    from public.company_profiles as profile
    where profile.user_id = requested_user_id
    limit 1
$$;

revoke all on function public.get_public_company_card(uuid) from public;
grant execute on function public.get_public_company_card(uuid) to anon, authenticated;

create table if not exists public.card_contact_exchanges (
    id bigint generated by default as identity primary key,
    card_owner_id uuid not null references auth.users (id) on delete cascade,
    visitor_name text not null check (char_length(visitor_name) between 1 and 100),
    visitor_phone text not null check (char_length(visitor_phone) between 3 and 40),
    visitor_email text check (visitor_email is null or char_length(visitor_email) <= 254),
    visitor_company text check (visitor_company is null or char_length(visitor_company) <= 120),
    visitor_role text check (visitor_role is null or char_length(visitor_role) <= 120),
    visitor_message text check (visitor_message is null or char_length(visitor_message) <= 1000),
    consented_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

alter table public.card_contact_exchanges enable row level security;
revoke all on public.card_contact_exchanges from anon, public;
grant select on public.card_contact_exchanges to authenticated;

drop policy if exists "Card owners can read their contact exchanges" on public.card_contact_exchanges;
create policy "Card owners can read their contact exchanges"
    on public.card_contact_exchanges for select to authenticated
    using ((select auth.uid()) = card_owner_id);

create or replace function public.submit_public_card_exchange(
    requested_card_owner_id uuid,
    submitted_name text,
    submitted_phone text,
    submitted_email text,
    submitted_company text,
    submitted_role text,
    submitted_message text,
    submitted_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    if submitted_role is not null and char_length(submitted_role) > 120 then
        raise exception 'Role is too long.';
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
        where profile.user_id = requested_card_owner_id
          and char_length(btrim(profile.full_name)) > 0
    ) then
        raise exception 'This business card is unavailable.';
    end if;

    insert into public.card_contact_exchanges (
        card_owner_id,
        visitor_name,
        visitor_phone,
        visitor_email,
        visitor_company,
        visitor_role,
        visitor_message
    )
    values (
        requested_card_owner_id,
        btrim(submitted_name),
        btrim(submitted_phone),
        nullif(btrim(submitted_email), ''),
        nullif(btrim(submitted_company), ''),
        nullif(btrim(submitted_role), ''),
        nullif(btrim(submitted_message), '')
    );
end;
$$;

revoke all on function public.submit_public_card_exchange(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.submit_public_card_exchange(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;

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
