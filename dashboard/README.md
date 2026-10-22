# BlipLink application and database

For account-management steps, use the beginner guide in the [project README](../README.md). Install or upgrade the database with **setup.sql**, in one SQL Editor run. Do not rerun an individual SQL component on its own: the combined file preserves the correct installation order and applies the upgrade in one transaction.

## Account model

`public.account_settings` is the authoritative account configuration, managed through Supabase Table Editor. Native enum fields expose `individual`/`company`, `monthly`/`yearly`, and `active`/`inactive` choices. Email is normalized to lowercase. A row may be prepared before its Auth user exists. On invitation/user creation, a trigger claims that row, fills `user_id`, starts the selected access period, and creates the initial profile. Unprepared users get an inactive individual account. Auth metadata grants no privileges.

The user ID and login email remain linked when the Auth email changes. Account settings cannot be reassigned to another existing user. Profile limits cannot be reduced below current usage. Individuals always have exactly one allowed profile. The account row synchronizes `account_access` and `company_subscriptions` for compatibility with existing profiles and functions; manage customer choices only in `account_settings`.

Authenticated customers can read only their own configuration. They cannot change type, limit, status, dates, or renew access. `get_my_account_access()` supplies the account type, allowance, period, dates, effective state, and server-calculated edit permission. A shared frontend module displays those states in both workspaces and refreshes them once per minute while open.

## Expiry and renewal

An account is active only when its status is active and the database's current time falls between `starts_at` and `expires_at`. Monthly/yearly periods use calendar intervals, including month-end and leap-year handling. Scheduled, inactive, and expired accounts cannot edit profiles, create additional profiles, delete profiles through RPC, upload/change/delete profile images, or use CRM. Public card and appearance RPCs hide their cards. Public analytics and contact-exchange writes reject unavailable cards. No cron job is needed.

Users retain their profiles and designs while paused. The individual editor becomes read only; the company dashboard shows access details and support. Renewal restores access and existing public URLs. `renew_account_access(email, periods)` is executable only by the database owner/service role. It preserves remaining active time. No payment integration or automatic renewal is included.

## Frontend routes

- `/login.html` handles email/password sign-in and invitation password setup. `/login` is a clean URL alias.
- `/dashboard/` is the company overview. `/dashboard/profile`, `/dashboard/theme`, `/dashboard/leads`, `/dashboard/crm`, `/dashboard/company`, `/dashboard/subscription`, `/dashboard/help`, and `/dashboard/personal` are clean URLs for their respective pages. Existing `.html` dashboard URLs redirect to the clean paths. Old company dashboard routes redirect individual accounts to the personal workspace before company data is loaded.
- `/card?id=<profile-id>` renders available public cards. Existing card IDs are preserved; `/card.html` redirects to the clean path.

The in-app admin page, API, membership table, and admin-grant functions have been removed. Account management happens only in Supabase.

## Themes and preview

`company_profiles.card_theme` stores validated-size JSON. A shared browser normalizer accepts only known color, font, layout, spacing, shape, and visibility options. It accepts no arbitrary CSS or HTML. Five presets can be customized, saved, and reloaded. The same-origin iframe preview reuses the actual public-card renderer without sending analytics. Active Individual and Company cards accept consented contact exchanges; owners review requests in their workspace.

## Auth, hosting, and storage

### Company identity and shared themes

`company_branding` holds one company identity per Auth owner, separate from the employee quota. Its RLS allows only that company's owner to read it, and only active company owners to insert or update. Individuals cannot access this table. On upgrade, the oldest employee card supplies the initial company details; `ON CONFLICT` and an existence check preserve later customization. New companies create their branding record on their first save. No employee profile or card ID is deleted or reassigned.

Company cards derive their shared company name, banner, address, website, wallets, company links and theme when the public RPCs run. An update therefore applies to all existing and future employee cards without copying company values into each employee record. A trigger rejects employee writes to shared company fields, including banner and card theme. Employees retain their own photo, personal contacts, LinkedIn, WhatsApp, introduction, department, optional alternate language name/role, secondary phone and booking link. Appearance RPCs expose only the public fields of available, unlocked, named cards.

Banner positioning is stored as a bounded vertical percentage. Company image paths must belong to the owner. Links accept HTTPS and are rendered as text, never HTML. The preview iframe accepts messages only from the same-origin parent. Preview mode performs no analytics or contact exchange writes. Removing a team member does not delete legacy image files, because the company or another card may still reference them.

Keep public registration disabled in Supabase Auth. Set the project Site URL and allowed Redirect URL to the deployed `/login.html` (currently `https://bliplink.vercel.app/login.html`). Keep the standard invitation confirmation link in the Supabase email template. Database setup cannot change these project-level Auth settings.

`config.js` contains only the public project URL and publishable key. Vercel needs server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for `/api/track-event`. The service key never reaches the browser. Analytics use trusted hosting country/city headers and store aggregate counts, not raw IP addresses.

The public `profile-photos` bucket supports JPG, PNG, WebP, and GIF uploads up to 5 MB. Ownership policies restrict writes to the user's folder and require active access. Public cards can include social links, WhatsApp, QR codes, vCard downloads, and issuer-provided Apple/Google Wallet pass links.

## Maintaining and testing

SQL source components are `schema.sql`, `account-access.sql`, `card-themes.sql`, `account-settings.sql`, and `company-branding.sql`. After editing a component, run `npm run db:build` to regenerate `setup.sql`. A test verifies that the generated setup matches its sources.

Run `npm ci` and `npm test`. PGlite runs the complete database installation, provisioning, RLS, quota, expiry, renewal, and repeat-upgrade checks against PostgreSQL. Startup checks cover every company route; theme/access helpers have focused tests.

With Playwright and Microsoft Edge available, run `node tests/verify-account-ui.cjs`. It uses fake users and sends no real invitations. It checks removed admin routes, both workspaces, responsive layouts, theme save/reload/public rendering, expired accounts, and reactivation. `BLIPLINK_PLAYWRIGHT` can specify a bundled module path and `BLIPLINK_QA_OUTPUT` can specify the screenshot directory.
