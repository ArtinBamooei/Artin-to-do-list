# Security deployment checklist

This repository contains a static GitHub Pages application and Cloudflare Worker source. Changes to Worker source/configuration do not deploy to Cloudflare automatically.

## Required Cloudflare deployment

1. In a trusted terminal, from a clone of this repository, authenticate Wrangler to the intended Cloudflare account.
2. Confirm the Groq API key is stored as the Worker secret named `GROQ_API_KEY`. Never commit it to Git or place it in frontend files. If the previously exposed key has not already been revoked, revoke it in Groq and create a replacement before deployment.
3. Deploy the chat Worker and its rate-limit binding:

   ```sh
   npx wrangler deploy --config wrangler-chat.toml
   ```

4. Verify the Worker reports a deployed `CHAT_RATE_LIMITER` binding and test normal chat, invalid content type, disallowed Origin, and the rate-limit response.
5. The optional market Worker is not wired into the page while `LIVE_API_URL` in `market-rates.js` remains empty. Only deploy it if enabling that feature:

   ```sh
   npx wrangler deploy --config wrangler-market.toml
   ```

## GitHub account/repository settings to verify

These controls cannot be safely changed through repository file commits alone:

- Enable secret scanning and push protection, Dependabot alerts, and private vulnerability reporting if available.
- Require two-factor authentication for the account and review collaborator/access-token permissions.
- Protect `main`; require the **Security and syntax checks** workflow to pass before merging, and restrict force pushes/deletions.
- Review repository Actions permissions and allow only trusted actions. The market workflow pins its GitHub actions to full commit SHAs.
- Review the Git history and revoke any credential that was ever committed or exposed. Removing a secret from the latest files does not revoke it or erase historical copies.

## Hosting limitation

GitHub Pages does not let this repository configure arbitrary HTTP response headers. The page therefore uses a strict CSP meta policy, but response-header-only controls such as HSTS and `frame-ancestors` must be enforced by a reverse proxy/custom hosting layer if those controls are required. The Cloudflare Workers set security headers on their API responses.
