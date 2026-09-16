// Supabase Edge Function: send-sms (Public REST API for External Apps)
// Deploy with: supabase functions deploy send-sms --no-verify-jwt
//
// Fixes applied (see docs/SYSTEM_ANALYSIS_REPORT.md):
//  - H7: full input validation (E.164, message length, sim slot)
//  - P6: no per-request last_used_at write (usage log + cron rollup),
//        key revocation/expiry checks, per-key fixed-window rate limiting
//  - C3: realtime broadcast wake-up on a public channel (no RLS dependency)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LENGTH = 1600;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const RATE_LIMIT_PER_MINUTE = 60;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Bearer API key" }, 401);
    }
    const apiKey = authHeader.replace("Bearer ", "").trim();
    const keyHash = await sha256Hex(apiKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- API key lookup + lifecycle checks (P6) ----
    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("id, organization_id, revoked_at, expires_at")
      .eq("key_hash", keyHash)
      .single();

    if (keyError || !keyData) {
      return jsonResponse({ error: "Unauthorized: Invalid API key" }, 401);
    }
    if (keyData.revoked_at) {
      return jsonResponse({ error: "Forbidden: API key has been revoked" }, 403);
    }
    if (keyData.expires_at && new Date(keyData.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: "Forbidden: API key has expired" }, 403);
    }

    // ---- Per-key rate limiting (P6) ----
    const { data: allowed, error: rateErr } = await supabase.rpc(
      "check_api_key_rate_limit",
      { p_key_id: keyData.id, p_limit: RATE_LIMIT_PER_MINUTE }
    );
    if (rateErr) {
      console.error("Rate limit check failed:", rateErr.message);
    } else if (allowed === false) {
      return new Response(
        JSON.stringify({ error: "Too Many Requests: per-key rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }


    // Usage logging is an append-only insert, rolled up to last_used_at by cron
    await supabase.rpc("log_api_key_usage", { p_key_id: keyData.id });

    // ---- Input validation (H7) ----
    const body = await req.json();
    const { to, message, sim_slot } = body ?? {};

    if (!to || typeof to !== "string" || !E164_RE.test(to.trim())) {
      return jsonResponse(
        { error: "Invalid payload. 'to' must be an E.164 phone number, e.g. +19162255887." },
        400
      );
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return jsonResponse({ error: "Invalid payload. 'message' (text) is required." }, 400);
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return jsonResponse(
        { error: `Invalid payload. 'message' exceeds ${MAX_MESSAGE_LENGTH} characters (max ~10 SMS parts).` },
        422
      );
    }
    let requestedSimSlot: number | null = null;
    if (sim_slot !== undefined && sim_slot !== null) {
      const slot = Number(sim_slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 1) {
        return jsonResponse({ error: "Invalid payload. 'sim_slot' must be 0 or 1." }, 422);
      }
      requestedSimSlot = slot;
    }

    // ---- Insert into outbound queue ----
    const { data: inserted, error: insertError } = await supabase
      .from("outbound_messages")
      .insert({
        organization_id: keyData.organization_id,
        phone_number: to.trim(),
        message: message.trim(),
        requested_sim_slot: requestedSimSlot,
        status: "pending",
      })
      .select("id, phone_number, message, status, created_at")
      .single();

    if (insertError) {
      return jsonResponse(
        { error: "Failed to queue message", details: insertError.message },
        500
      );
    }

    // ---- Realtime broadcast wake-up (C3) ----
    // Public broadcast channel: devices subscribe with the anon key and are NOT
    // subject to RLS row filters (unlike postgres_changes). This is the instant
    // wake-up path; 10s polling and FCM remain fallbacks.
    try {
      const channel = supabase.channel(`gateway_queue:${keyData.organization_id}`);
      await channel.subscribe();
      await channel.send({
        type: "broadcast",
        event: "queue_updated",
        payload: { messageId: inserted.id },
      });
      supabase.removeChannel(channel);
    } catch (e) {
      console.warn("Realtime broadcast failed (queue remains poll-safe):", e);
    }

    const { count } = await supabase
      .from("gateway_devices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", keyData.organization_id)
      .not("fcm_token", "is", null);

    return jsonResponse(
      {
        success: true,
        messageId: inserted.id,
        status: inserted.status,
        to: inserted.phone_number,
        createdAt: inserted.created_at,
        devicesNotified: count ?? 0,
      },
      201
    );
  } catch (err) {
    return jsonResponse({ error: "Internal Server Error", details: String(err) }, 500);
  }
});
