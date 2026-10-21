# BlipLink Company Dashboard

The dashboard is a static frontend backed by Supabase Authentication, PostgreSQL, and Supabase Storage. Public account registration is not provided. A BlipLink administrator invites company users through Supabase; invitees set their password from the secure email link before signing in.

Each dashboard section has its own HTML route: index.html (Overview), profile.html, social.html, leads.html, crm.html, company.html, subscription.html, and help.html. All routes share the same signed-in dashboard session and sidebar navigation.

## Supabase setup

The dashboard frontend is configured for the BlipLink Supabase project in [`config.js`](./config.js). Its `sb_publishable_...` key is intended for browser use; never put a Supabase secret/service-role key in this file.

Run the current [`schema.sql`](./schema.sql) in the Supabase SQL Editor before using the dashboard. It creates a company profile and an inactive subscription row for new Auth users, backfills both for existing users, enables profile locking/deletion, daily analytics, lead notifications, and the CRM pipeline. Re-running the script preserves existing card URLs. Before inviting companies:

1. In **Authentication → Settings → General**, disable public sign-ups. Invitations are sent by an authorized project administrator; visitors cannot register themselves.
2. In **Authentication → URL Configuration**, set **Site URL** to `https://bliplink.vercel.app/login.html`. Add that exact URL under **Redirect URLs** and remove old localhost/development entries. Supabase uses the Site URL as the return destination when an invitation is sent from its Users screen; the deployed login page handles the invite and password setup. This project-level Auth URL setting cannot be changed by `schema.sql`.
3. Keep the email template’s standard confirmation link, `{{ .ConfirmationURL }}`, so Supabase verifies the invitation before redirecting to the Site URL. Do not replace it with a localhost URL.
4. When the custom domain is live, add `https://bliplink.pro/login.html` to **Redirect URLs** and then change **Site URL** to `https://bliplink.pro/login.html`.
5. Under **Authentication → Users**, choose **Add user → Send invitation**, enter the company email, and send it. When the invitee clicks the email link, they return to the existing `login.html`; it displays the invited email and password/confirmation fields, then sends them to the dashboard. There is no separate registration page or public sign-up flow.
6. Deploy the site with the `dashboard/` directory and `login.html` included. The homepage sends visitors to `/login.html`; after sign-in, they go to `/dashboard/index.html`. Opening the dashboard while signed out returns visitors to the sign-in page.

Note: the invitation redirect is configured in the Supabase dashboard, not in this static site. If Supabase reports **email rate limit exceeded** while sending an invite, that is a separate Supabase email-delivery limit; changing this site’s redirect code cannot increase that limit.

The `profile-photos` bucket is limited to 5 MB image uploads. Profile images are public so they can load on shared digital cards; upload, update, and delete access remains restricted to the owner’s folder.

## Analytics and server configuration

The Overview shows all-time views, views during the latest 30 days, the top city, and a daily taps/leads chart that can be filtered by profile and date range. New view/tap events update all-time counters and daily aggregates; new leads are grouped by their UTC date. Daily chart history starts when the latest schema is installed; existing all-time totals are retained, but older daily buckets cannot be reconstructed from those totals.

The top-city metric uses Vercel’s trusted `x-vercel-ip-city` and `x-vercel-ip-country` headers. Only city/country aggregate counts are stored—never visitor IP addresses or precise coordinates. The city metric remains empty when the hosting provider does not supply a supported city header. No map is included in the dashboard.

The public card sends analytics to [`../api/track-event.js`](../api/track-event.js). In the Vercel project settings, configure these **server-side environment variables** for every deployed environment:

- `SUPABASE_URL`: the project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role secret. Keep this only in Vercel server-side environment variables; never add it to `config.js`, browser code, or a committed file.

Redeploy after setting the variables, then run the latest `schema.sql`. Without the server function and environment variables, public cards still render, but view/tap totals, daily chart data, and top-city counts will not be recorded. A static Live Server session does not run Vercel API functions; use `vercel dev` with the server-side variables to test analytics locally. Local requests usually have no trusted city header, so they will not contribute to top-city counts.

## Manual annual subscriptions

The dashboard displays a read-only `$6.99 USD / year` subscription status, start date, expiry date, and remaining days while active. The `starts_at` and `expires_at` values are persisted in `public.company_subscriptions`. Re-running `schema.sql` adds either date column if the table already existed. There is no payment provider or automatic billing; an administrator confirms payment outside the app and sets dates directly in the Supabase SQL Editor. To activate an account for one year, replace the email below and run:

```sql
update public.company_subscriptions
set status = 'active',
    starts_at = now(),
    expires_at = now() + interval '1 year',
    updated_at = now()
where user_id = (
    select id from auth.users where lower(email) = lower('company@example.com')
);
```

To deactivate an account, set `status = 'inactive'`, `starts_at = null`, and `expires_at = null`. Authenticated company users can read their own subscription but cannot modify it.

## Public digital cards

Each saved profile gets a URL in the form `card.html?id=<profile-id>`. The dashboard’s **View card** button opens it in a new tab, and **Copy link** copies its address. Public cards include a customizable banner and profile photo, plain email/phone/website details, social icons (including WhatsApp, Facebook, TikTok, GitHub, Telegram, Discord, and Snapchat), a QR code, and a downloadable contact file. Locked profiles are hidden from visitors; at least one profile must remain on each company account. A saved business address appears at the bottom of the card, above optional wallet links, and opens a Google Maps search when selected. Companies enter a WhatsApp number with country code; BlipLink turns it into a `wa.me` chat link. Companies can paste their issuer-generated Apple Wallet and Google Wallet pass URLs into their profile; the corresponding links appear on the public card only when provided.

Visitors can submit a contact exchange after explicitly consenting and can optionally enter their interested services in a free-text field. The text is saved in `visitor_services` on `card_contact_exchanges` and copied to `services` on `crm_leads`; existing selections and role values remain available for older records. Run the current [`schema.sql`](./schema.sql) in Supabase to add these columns and update the public submission function. Only the associated company account can read exchange details in its dashboard. A company can save those submissions to `crm_leads`, track pipeline stage, notes, and follow-up date, and manage multiple employee cards from one login. The Overview shows all-time profile visits, link taps, country aggregates, and leads; lead and analytics changes refresh through Supabase Realtime. The QR image is generated by the QR Server image API from the public card URL. BlipLink displays wallet pass links from the company’s existing issuer; it does not generate wallet passes.

## Included

- Email/password sign-in and sign-out, with no register form or sign-up action.
- A clean `/login.html` sign-in route; the dashboard app remains separate and requires an active session.
- Responsive dashboard with profile editing and a live preview.
- Public, responsive profile cards with plain contact details, social icons, and downloadable vCard contacts.
- QR codes, card sharing, consent-based lead capture, an owner-only Leads inbox, and a CRM pipeline.
- Multiple employee profiles per company login, with view/edit/lock/unlock/delete actions and one-profile minimum.
- Aggregate view/tap totals, daily chart history, and city-level visitor counts; no raw IP or precise coordinates are stored.
- Real-time new-lead notifications, a mobile floating notification button, and refreshed visitor analytics.
- Read-only subscription status at $6.99/year, manually activated by an administrator.
- WhatsApp support at [`https://wa.me/77770665790`](https://wa.me/77770665790).
- GitHub, Telegram, Discord, and Snapchat profile links alongside the existing social networks.
- Per-account card link with one-click preview and copy actions.
- Profile photo upload and removal.
- Website, LinkedIn, Instagram, and X link editing, plus WhatsApp number-to-chat-link support.
- Banner photo upload/removal and optional Apple Wallet/Google Wallet issuer pass links.
- English-only dashboard UI; public website language selection remains separate.

For local testing, serve the site over HTTP (for example, VS Code Live Server); browser authentication and storage do not work reliably from `file://`.
