# PG 95 Admin Portal

React, TypeScript, Tailwind CSS, and Supabase-based branch-wise PG administration.

## Supabase tables

- `profiles`
- `staff_members`
- `branches`
- `branch_assignments`
- `staff_permissions`
- `rooms`
- `tenants`
- `payments`
- `cashbook_entries`
- `expenses`
- `inventory_items`
- `inventory_purchases`
- `maintenance_tickets`
- `invoices`
- `activity_logs`

All business tables use Row Level Security. Admins can access every branch. Staff reads are limited to `branch_assignments`, and writes additionally require the corresponding `staff_permissions` row.

## First-time Supabase setup

1. Open Supabase Dashboard > SQL Editor.
2. Run `supabase/migrations/202606270001_pg_admin_schema.sql`.
3. Open Authentication > Users and create the owner email/password.
4. Replace `OWNER_EMAIL_HERE` in `supabase/seed-admin.sql`, then run that SQL once.
5. Install the Supabase CLI and link the project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy create-staff
```

The `SUPABASE_SERVICE_ROLE_KEY` used by `create-staff` is supplied automatically inside Supabase Edge Functions. Never add it to Vite or Vercel.

## Local environment

Copy `.env.example` to `.env` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY
```

The URL must be the project base URL, not a URL ending in `/rest/v1/`. The app normalizes either form, but the canonical value is recommended.

```bash
npm install
npm run dev
npm run build
```

## Vercel deployment

1. In Vercel > Project > Settings > Environment Variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production, Preview, and Development.
2. In Supabase > Authentication > URL Configuration, set Site URL to the Vercel production URL and add the Vercel preview URL pattern as a redirect URL.
3. Deploy the SQL migration and `create-staff` Edge Function before the Vercel build.
4. Push the committed branch. Vercel will build with `npm run build`.
5. Sign in as the owner, create a branch, then create staff accounts and assign their branch permissions in Settings.

## Security notes

- Only the anon public key is used in the browser.
- Staff Auth users are provisioned by the authenticated admin through the Edge Function.
- The service-role key never enters the frontend bundle.
- RLS is the enforcement layer; hidden UI buttons are only a usability layer.
