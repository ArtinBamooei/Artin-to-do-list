/**
 * Live TGJU market endpoint for Cloudflare Workers.
 * Deploy with: npx wrangler deploy
 */
const ORIGINS = new Set([
  "https://artinbamooei.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);
const MARKETS = {
  usd: { label: "دلار آزاد", slug: "price_dollar_rl", unit: "تومان", oil: false },
  eur: { label: "یورو", slug: "price_eur", unit: "تومان", oil: false },
  gold: { label: "طلای ۱۸ عیار", slug: "geram18", unit: "تومان / گرم", oil: false },
  oil: { label: "نفت برنت", slug: "energy-brent-oil", unit: "دلار / بشکه", oil: true },
};
const now = () => new Date().toISOString();
function plainText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:tr|td|th|p|div|h1|h2|h3|li|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ");
}
function latinDigits(s) {
  return s.replace(/[۰-۹٠-٩]/g, d => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) % 10));
}
function parse(html, market) {
  const text = latinDigits(plainText(html));
  const m = text.match(/نرخ\s*فعلی\s*:?\s*([0-9][0-9,٬،.]*)/);
  if (!m) throw new Error("Current quote not found on TGJU page");
  const price = Number(m[1].replace(/[,٬،]/g, ""));
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid quote");
  if (market.oil && (price < 10 || price > 300)) throw new Error("Brent quote outside sanity bounds");
  if (market.slug === "geram18" && (price < 100000 || price > 1000000000)) throw new Error("Gold quote outside sanity bounds");
  if (["price_dollar_rl", "price_eur"].includes(market.slug) && (price < 1000 || price > 100000000)) throw new Error("FX quote outside sanity bounds");
  const time = text.match(/زمان\s+ثبت\s+آخرین\s+نرخ\s*([^\n]{1,45})/);
  return { price: Math.round(price * 100) / 100, sourceDate: time ? time[1].trim().slice(0, 45) : null };
}
function response(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000",
    },
  });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ORIGINS.has(origin) ? origin : "";
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return new Response(null, { status: 403 });
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      }});
    }
    if (url.pathname !== "/api/market") return response({ error: "Not found" }, 404, "");
    if (!allowedOrigin) return response({ error: "Origin not allowed" }, 403, "");
    if (request.method !== "GET") return response({ error: "Method not allowed" }, 405, allowedOrigin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.MARKET_RATE_LIMITER) {
      try {
        const { success } = await env.MARKET_RATE_LIMITER.limit({ key: ip });
        if (!success) return response({ error: "Too many requests." }, 429, allowedOrigin);
      } catch {
        return response({ error: "Service temporarily unavailable." }, 503, allowedOrigin);
      }
    }

    // A short edge cache prevents a burst of page reloads from hammering TGJU.
    const cacheKey = new Request(new URL("/api/market", url.origin).toString(), { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("Access-Control-Allow-Origin", allowedOrigin);
      headers.set("Vary", "Origin");
      return new Response(cached.body, { status: cached.status, headers });
    }

    const checkedAt = now();
    const items = {};
    const failedItems = {};
    for (const [key, market] of Object.entries(MARKETS)) {
      const sourceUrl = "https://www.tgju.org/profile/" + market.slug;
      try {
        const res = await fetch(sourceUrl, { headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ArtinMarketPriceBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.7",
        }, signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error("TGJU HTTP " + res.status);
        const quote = parse(await res.text(), market);
        items[key] = { label: market.label, price: quote.price, unit: market.unit, source: "TGJU", sourceUrl, sourceDate: quote.sourceDate, fetchedAt: checkedAt, stale: false };
      } catch (e) {
        failedItems[key] = String(e && e.message || e).slice(0, 160);
      }
    }
    const body = { source: "TGJU", checkedAt, lastAttemptAt: checkedAt, scheduleMinutes: 0, successfulItems: Object.keys(items), failedItems, items };
    const result = response(body, Object.keys(items).length ? 200 : 502, allowedOrigin);
    if (Object.keys(items).length) {
      const cachedResponse = result.clone();
      cachedResponse.headers.set("Cache-Control", "public, max-age=30");
      ctx.waitUntil(cache.put(cacheKey, cachedResponse));
    }
    return result;
  },
};
