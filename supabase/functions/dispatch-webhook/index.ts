// Supabase Edge Function: dispatch-webhook (C5 hardening)
//
// Fixes applied (see docs/SYSTEM_ANALYSIS_REPORT.md):
//  - C5: delivery is only marked successful when the POST actually succeeds
//  - C5: 10s timeout, exponential backoff via webhook_outbox, dead-lettering
//  - C5: SSRF guard — https-only, private/loopback/metadata hosts rejected
//
// Two modes:
//  1. Database webhook payload {type, table, record} — deliver + enqueue on failure
//  2. {mode:"retry_outbox"} — invoked by pg_cron/pg_net every minute to retry due rows

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REQUEST_TIMEOUT_MS = 10_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function createHmacSha256(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// SSRF guard (C5): https only; reject loopback, private ranges, link-local and
// cloud metadata hosts. Hostname-level check — DNS rebinding is additionally
// mitigated by egress restrictions on the Supabase runtime.
export function isSafeWebhookUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return false;
  }
  const m172 = host.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return false;
  }
  if (host === "[::1]" || host === "::1" || host === "0.0.0.0" || host === "[fd00::1]") {
    return false;
  }
  return true;
}

async function postWebhook(
  url: string,
  secret: string,
  payload: string
): Promise<{ ok: boolean; status: number | string }> {
  const signature = await createHmacSha256(secret, payload);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Signature": `sha256=${signature}`,
        "User-Agent": "Supabase-SMS-Gateway/1.0",
      },
      body: payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    return { ok: false, status: String(e instanceof Error ? e.message : e) };
  }
}

serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const body = await req.json();

    // ---- Mode 2: outbox retry loop (invoked by pg_cron/pg_net) ----
    if (body?.mode === "retry_outbox") {
      const { data: due, error } = await supabase.rpc("fetch_due_webhooks", { p_limit: 20 });
      if (error) return jsonResponse({ error: error.message }, 500);

      let delivered = 0;
      for (const row of due ?? []) {
        const { data: org } = await supabase
          .from("organizations")
          .select("webhook_url, webhook_secret")
          .eq("id", row.organization_id)
          .single();

        if (!org?.webhook_url || !isSafeWebhookUrl(org.webhook_url)) {
          await supabase.rpc("record_webhook_attempt", {
            p_outbox_id: row.id, p_success: false, p_status_text: "unsafe or missing webhook_url",
          });
          continue;
        }

        const result = await postWebhook(
          org.webhook_url,
          org.webhook_secret,
          typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload)
        );
        if (result.ok) delivered++;
        await supabase.rpc("record_webhook_attempt", {
          p_outbox_id: row.id,
          p_success: result.ok,
          p_status_text: String(result.status),
        });
      }
      return jsonResponse({ mode: "retry_outbox", processed: due?.length ?? 0, delivered });
    }

    // ---- Mode 1: database webhook event {type, table, record} ----
    const { type, table, record } = body;
    const organizationId = record?.organization_id;
    if (!organizationId) {
      return jsonResponse("No organization_id in record", 400);
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("webhook_url, webhook_secret")
      .eq("id", organizationId)
      .single();

    if (orgError || !org?.webhook_url) {
      return jsonResponse("No webhook_url configured for organization", 200);
    }

    // SSRF guard — refuse to POST anywhere unsafe
    if (!isSafeWebhookUrl(org.webhook_url)) {
      console.error(`Blocked unsafe webhook_url for org ${organizationId}`);
      return jsonResponse({ blocked: "unsafe webhook_url" }, 200);
    }

    const eventName = table === "inbound_messages" ? "sms.received" : `sms.${record.status}`;
    const webhookPayload = JSON.stringify({
      event: eventName,
      timestamp: new Date().toISOString(),
      data: record,
    });

    const result = await postWebhook(org.webhook_url, org.webhook_secret, webhookPayload);

    // Only mark dispatched on actual success (C5: no more silent data loss)
    if (result.ok && table === "inbound_messages") {
      await supabase
        .from("inbound_messages")
        .update({ webhook_dispatched_at: new Date().toISOString() })
        .eq("id", record.id);
    }

    if (!result.ok) {
      // Enqueue for retry with exponential backoff; dead-letters after max attempts
      await supabase.rpc("enqueue_webhook_event", {
        p_organization_id: organizationId,
        p_payload: webhookPayload,
      });
    }

    return jsonResponse({ delivered: result.ok, status: result.status });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});

