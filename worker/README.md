# Live TGJU endpoint (Cloudflare Worker)

This Worker fetches the public TGJU pages server-side, validates the four quotes, and returns JSON with CORS restricted to the GitHub Pages origin. A 30-second edge cache protects TGJU from repeated reloads.

## Deploy once

1. Create/sign in to a Cloudflare account and open Workers & Pages.
2. In a local clone of this repository, install Node.js and run:
   `npm install --global wrangler`
3. Authenticate: `wrangler login`
4. From the repository root run: `wrangler deploy`
5. Cloudflare prints a URL like `https://artin-market-api.<your-subdomain>.workers.dev`.

## Connect the website

In `market-rates.js`, set `LIVE_API_URL` to that exact URL plus `/api/market`, e.g. `https://artin-market-api.<your-subdomain>.workers.dev/api/market`, and commit the change. Do not put API tokens or Cloudflare secrets in frontend JavaScript.

## Notes

- This is an unauthenticated, read-only public market endpoint; only the site's origin is accepted by CORS. CORS is a browser control, not strong authentication.
- Edge cache lasts 30 seconds. Reloading during that interval can legitimately show the same quote; after the cache expires, a new request fetches TGJU.
- TGJU can block requests or publish delayed quotes. The Worker reports source fetch time separately from TGJU's own quote timestamp.
- Existing GitHub Actions snapshot remains the fallback if the live endpoint is not configured or fails.
