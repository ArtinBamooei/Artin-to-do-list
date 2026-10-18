# Personal assistant API (Groq + Cloudflare Workers)

This is a separate Worker from `artin-market-api`; it does not replace the market-prices Worker.

## 1. Deploy the chat Worker

From the repository root, with Node.js and Wrangler installed and authenticated:

```sh
npx wrangler deploy --config wrangler-chat.toml
```

Cloudflare will print a URL similar to `https://artin-personal-assistant.<your-subdomain>.workers.dev`.

## 2. Store the Groq key as a secret

In Cloudflare Dashboard:
1. Open **Workers & Pages** and select `artin-personal-assistant`.
2. Open **Settings → Variables and Secrets → Add**.
3. Choose **Secret** (not plain text variable).
4. Set the variable name to `GROQ_API_KEY` and paste the Groq key as its value.
5. Save/deploy the change.

Alternatively, run:

```sh
npx wrangler secret put GROQ_API_KEY --config wrangler-chat.toml
```

Do not commit the key or paste it into the website JavaScript.

## 3. Connect the website

Edit `assistant.js` and replace `YOUR-SUBDOMAIN` in `API_URL` with the exact Worker hostname Cloudflare assigned, keeping the final `/api/chat` path. Commit and wait for GitHub Pages to publish.

## Notes

- The default model is `openai/gpt-oss-20b`; change the `MODEL` constant in `worker/chat-api.js` only to a model currently enabled for your Groq account.
- The Worker limits message sizes and has a small in-memory per-IP throttle. In-memory limits are best-effort and can reset or vary across Worker instances; configure Cloudflare's managed rate limiting for stronger public abuse protection.
- CORS only controls browser access and is not authentication. Anyone can call a public endpoint outside a browser, so review usage regularly.
- The UI keeps chat history in memory only; refreshing the page clears the conversation.
