# BlipLink — start here

BlipLink has two kinds of customer accounts. Individuals get one customizable card. Companies get the number of profiles you allow, plus the company dashboard, leads, and CRM. You manage accounts in Supabase; there is no admin section inside BlipLink.

## 1. Run the database setup once

Open [dashboard/setup.sql](dashboard/setup.sql), copy the **whole file**, paste it into your Supabase project's **SQL Editor**, and click **Run**. This is the one file to use for both a fresh setup and an upgrade from the earlier version. It preserves existing profiles, links, themes, account types, profile allowances, and subscription dates. It also removes the old in-app administrator permissions.

Existing inactive accounts stay inactive. Review them in the next step and activate the accounts that should have access.

Public registration is enabled for individual accounts at `/register` (or `/register.html`). Company accounts remain invitation-only. Keep Supabase email confirmation enabled and set its **Site URL** and allowed redirect URL to your live `/login.html`, currently `https://bliplink.vercel.app/login.html`; registration confirmation and password recovery return there. New individual signups need an `account_settings` row with active access before they can edit a profile. Invitation emails use Supabase's normal confirmation link so company users can set their own password.

## 2. Add an account's options

In Supabase, open **Table Editor → public → account_settings → Insert row**. Fill in these fields:

| Field | What you choose |
| --- | --- |
| `email` | The customer's login email |
| `account_type` | `individual` or `company` |
| `profile_limit` | `1` for an individual; your chosen total for a company, such as `10` |
| `access_period` | `monthly` or `yearly` |
| `access_status` | `active` to give access; `inactive` to pause it |

Leave `user_id`, `starts_at`, `expires_at`, and `updated_at` alone. The database fills them in when the matching Auth user is created. `notes` is optional and is never shown on public cards.

An individual's allowance always becomes **1**, even if a different number is entered. Company allowances include the initial profile: a limit of 10 means 10 total profiles.

## 3. Invite the same email

Open **Authentication → Users → Add user → Send invitation** and enter the **same email**. The database connects the user to the options you prepared. Monthly access starts for one calendar month; yearly access starts for one calendar year. The customer follows the email link to choose a password.

Supabase's built-in Authentication popup is separate from this app. The options live in **account_settings**, not in that popup. You do not need to write SQL for each new customer.

If you already invited a user, their row is already in **account_settings**. Edit that row instead of inviting them again. Users invited without prepared settings start as **inactive individuals** until you configure their access.

## 4. Manage and renew access

- **Increase a company allowance:** edit `profile_limit` in that customer's row. Users cannot create more than this allowance.
- **Pause access:** set `access_status` to `inactive`.
- **Start another period:** set `starts_at` to the new start date, clear `expires_at` to `NULL`, and set `access_status` to `active`. Expiry is calculated from the monthly/yearly choice.
- **Renew while keeping any remaining time:** run the following in SQL Editor, replacing the email:

```sql
select public.renew_account_access('customer@example.com');
```

The renewal adds one selected period to the current end date, or starts from now if access has already ended. To add three periods, use `select public.renew_account_access('customer@example.com', 3);`.

Once access expires, **editing pauses and public cards are hidden automatically**. Renewing restores the same cards, designs, and links. No scheduled job is needed. Customers see their access period and status in the app; existing open dashboards refresh that status every minute.

Changing a company to an individual, or lowering its allowance, is rejected if there are too many existing profiles. Remove the extra profiles first; the database never deletes cards automatically to fit a limit.

Payments remain manual. Monthly/yearly access controls duration; it does not charge a customer or renew automatically.

## Company dashboard update

To enable **My Team**, **Company**, and **Theme**, run the complete updated [dashboard/setup.sql](dashboard/setup.sql) once in Supabase **SQL Editor**, then refresh the dashboard. This is an upgrade: existing employee cards, public URLs, account allowances, and subscription dates stay in place.

- **Overview** shows the company identity instead of a selected employee.
- **My Team** has searchable employee cards, sorting and status filters. Edit a person's name, role, department, contact information, LinkedIn, booking link, introduction, and photo here. Alternate language names and job titles are supported.
- **Company** manages the company name, logo, shared banner and its position, company contact information, social media, app links, and wallet pass links. The old Social links page redirects here.
- **Theme** customizes the shared card colors, fonts, layout, shapes, spacing and visible sections, with a live preview using an actual team member. Saving applies the design to every current and future employee card.

Company information is stored separately in `company_branding`; it does not use an employee profile slot. Existing companies start with a copy of the oldest employee card's company fields, so check the company name, logo, and banner after upgrading. Employees' original records remain intact. Company branding is always used by company public cards; individual accounts keep their own card designs.

## Development and hosting

The site is deployed on Vercel. Its public Supabase configuration is in `dashboard/config.js`. Public card analytics use the server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` variables in Vercel; never put the service key into browser code.

Run `npm ci`, then `npm test`. Developer details are in [dashboard/README.md](dashboard/README.md).
