/**
 * Cloudflare Worker proxy for Arzhaam.
 * IMPORTANT: add ARZHAAM_API_KEY as a Worker Secret in Cloudflare.
 * Never paste the API key into this file or commit it to GitHub.
 */
const ALLOWED_ORIGIN = "https://artinbamooei.github.io";
const UPSTREAM = "https://arzhaam.ir/api/rates/latest?assets=usd,eur,gbp,gold_18";
const MAX_AGE_MS = 60 * 60 * 1000;

function response(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) return response({ error: "origin_not_allowed" }, 403, ALLOWED_ORIGIN);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }});
    }
    if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405, origin);
    const url = new URL(request.url);
    if (url.pathname !== "/rates") return response({ error: "not_found" }, 404, origin);
    if (!env.ARZHAAM_API_KEY) return response({ error: "server_secret_not_configured" }, 503, origin);

    try {
      const upstream = await fetch(UPSTREAM, {
        headers: { "X-App-Key": env.ARZHAAM_API_KEY, "Accept": "application/json" },
        signal: AbortSignal.timeout(8000)
      });
      if (!upstream.ok) return response({ error: "upstream_error", status: upstream.status }, 502, origin);
      const data = await upstream.json();
      const rates = Array.isArray(data.rates) ? data.rates : [];
      const now = Date.now();
      const cleanRates = rates.map(rate => {
        const updatedAt = rate.updatedAt ? Date.parse(rate.updatedAt) : NaN;
        const ageMs = Number.isFinite(updatedAt) ? now - updatedAt : Infinity;
        return {
          assetId: String(rate.assetId || ""),
          price: Number(rate.price),
          updatedAt: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : null,
          ageMs,
          valid: Number(rate.price) > 0 && ageMs >= 0 && ageMs <= MAX_AGE_MS
        };
      }).filter(rate => ["usd", "eur", "gbp", "gold_18"].includes(rate.assetId));
      return response({
        rates: cleanRates,
        fetchedAt: new Date(now).toISOString(),
        stale: cleanRates.length === 0 || cleanRates.some(rate => !rate.valid)
      }, 200, origin);
    } catch (_) {
      return response({ error: "upstream_unavailable" }, 502, origin);
    }
  }
};
