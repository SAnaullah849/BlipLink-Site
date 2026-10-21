const { PGlite } = require('@electric-sql/pglite');
async function createDatabase() {
    const db = new PGlite();
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create schema storage;
        grant usage on schema auth,storage,public to anon,authenticated,service_role;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        create table auth.users(id uuid primary key, email text unique, created_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
        create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
        alter table storage.objects enable row level security;
        grant select,insert,update,delete on storage.objects to authenticated;
        create function storage.foldername(name text) returns text[] language sql immutable as $$
            select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'),1)-1,0)];
        $$;
    `);
    return db;
}
module.exports = { createDatabase };
