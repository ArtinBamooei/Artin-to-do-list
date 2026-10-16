# Authentication setup (Supabase)

This repository is currently hosted on GitHub Pages, which is static hosting and cannot safely create accounts or enforce admin permissions by itself. These files are a backend scaffold; login is NOT active until the Supabase project is configured and the frontend is connected.

## Security model

- Supabase Auth verifies passwords and manages sessions.
- Usernames are mapped to synthetic addresses in `accounts.artinbamooei.com`; no email is sent. This domain is only an internal login identifier in this design, not an email inbox.
- `public.profiles.role` is the authoritative role table. The browser cannot insert, update, or delete profiles.
- The admin-create-user Edge Function validates the caller's session and checks the role on the server before using the secret key.
- The Supabase secret key must NEVER be placed in `index.html`, GitHub, or any browser bundle.
- A newly created user gets role `user`; only the initial owner account should be promoted to `admin`.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Create your first account in Supabase Auth with an email like `yourusername@accounts.artinbamooei.com`, a strong password, and user metadata `username: yourusername`. This first account is initially a normal user.
4. Run the final SQL statement in `schema.sql`, replacing `YOUR_ADMIN_USERNAME` with your exact username. Verify the row before proceeding. Never promote a username supplied by an untrusted user.
5. Deploy `supabase/functions/admin-create-user/index.ts` as an Edge Function named `admin-create-user`.
6. Configure Edge Function secrets (never commit values):
   - `SUPABASE_URL`: project URL
   - `SUPABASE_ANON_KEY`: publishable/anon key for user-session validation
   - `SUPABASE_SECRET_KEY`: project secret key (server only)
   - `APP_ORIGIN`: exact production origin, e.g. `https://OWNER.github.io` (not a path). Set this to the actual origin that serves the app.
7. Set Supabase Auth allowed URLs to the exact GitHub Pages site URL.
8. Connect the frontend using only the project URL and publishable key. Do not enable admin actions until the Edge Function is deployed and the admin role has been verified.

## Before production

- Add and test the login UI, session checks, admin panel, logout, account revocation, and password rotation.
- Add rate limiting / abuse protection at the edge and monitor auth logs. Configure a strong password policy and MFA for the admin if available.
- Add tests proving non-admin users receive 403 from the admin function and cannot alter profile roles.
- Existing planner tasks are in browser localStorage and are not automatically private or synced across devices. Authentication alone will not protect those old local records; move per-user task data to a database with Row Level Security if tasks must be private.
- Because username-only login has no verified recovery channel, plan a secure admin-controlled reset flow before real-world use.
