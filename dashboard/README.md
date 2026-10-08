# BlipLink Company Dashboard

The dashboard is a static frontend backed by Supabase Authentication, PostgreSQL, and private Supabase Storage. Public account registration is not provided. A BlipLink administrator creates company accounts and gives each company its login credentials.

## Supabase setup

The dashboard frontend is configured for the BlipLink Supabase project in [`config.js`](./config.js). Its `sb_publishable_...` key is intended for browser use; never put a Supabase secret/service-role key in this file.

The SQL in [`schema.sql`](./schema.sql) has been applied to the project. Before inviting companies:

1. In **Authentication → Settings**, disable public sign-ups. The dashboard has no registration screen, but this Auth setting is also required to prevent self-registration through the Supabase API.
2. Under **Authentication → Users**, create each company user manually with a unique email and password. Confirm the email or send the Supabase password setup/invitation flow before sharing access.
3. Deploy the site with the `dashboard/` directory included. The login is available at `/dashboard/`; the homepage login link points there.

The `profile-photos` bucket is private, limited to 5 MB image uploads, and uses signed URLs. Row-level security restricts each account to its own profile and photo folder.

## Included

- Email/password sign-in and sign-out, with no register form or sign-up action.
- Responsive dashboard with profile editing and a live preview.
- Profile photo upload and removal.
- Website, LinkedIn, Instagram, and X profile link editing.
- English-only dashboard UI; public website language selection remains separate.

For local testing, serve the site over HTTP (for example, VS Code Live Server); browser authentication and storage do not work reliably from `file://`.
