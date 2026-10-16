import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY")!;
const APP_ORIGIN = Deno.env.get("APP_ORIGIN")!;
const LOGIN_DOMAIN = "accounts.artinbamooei.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && origin !== APP_ORIGIN) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  if (req.headers.get("origin") !== APP_ORIGIN) return response({ error: "Forbidden" }, 403);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return response({ error: "Unauthorized" }, 401);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (profileError || profile?.role !== "admin") return response({ error: "Forbidden" }, 403);

    const body = await req.json();
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return response({ error: "Username must be 3-32 letters, numbers, underscores or hyphens" }, 400);
    }
    if (password.length < 12 || password.length > 128) {
      return response({ error: "Password must be 12-128 characters" }, 400);
    }

    const email = username.toLowerCase() + "@" + LOGIN_DOMAIN;
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
      app_metadata: { provisioned_by: userData.user.id },
    });
    if (createError || !created.user) {
      // Avoid leaking whether a particular username already exists.
      return response({ error: "Could not create account. Check the username and try again." }, 400);
    }
    return response({ user: { id: created.user.id, username } }, 201);
  } catch {
    return response({ error: "Invalid request" }, 400);
  }
});
