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
    website_url text check (website_url is null or char_length(website_url) <= 500),
    bio text check (bio is null or char_length(bio) <= 500),
    linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 500),
    instagram_url text check (instagram_url is null or char_length(instagram_url) <= 500),
    x_url text check (x_url is null or char_length(x_url) <= 500),
    avatar_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

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
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
