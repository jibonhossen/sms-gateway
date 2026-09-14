// Supabase Edge Function: dispatch-webhook (Signs with HMAC SHA-256 and POSTs to webhook URL)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Helper to compute HMAC SHA-256 hex string
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

serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const { type, table, record } = payload; // Supabase DB webhook payload structure

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const organizationId = record.organization_id;
    if (!organizationId) {
      return new Response("No organization_id in record", { status: 400 });
    }

    // Fetch tenant's webhook configuration
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("webhook_url, webhook_secret")
      .eq("id", organizationId)
      .single();

    if (orgError || !org || !org.webhook_url) {
      return new Response("No webhook_url configured for organization", { status: 200 });
    }

    const eventName = table === "inbound_messages" ? "sms.received" : `sms.${record.status}`;
    const webhookPayload = JSON.stringify({
      event: eventName,
      timestamp: new Date().toISOString(),
      data: record,
    });

    const signature = await createHmacSha256(org.webhook_secret, webhookPayload);

    // Send HTTP POST to tenant webhook endpoint
    const response = await fetch(org.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Signature": `sha256=${signature}`,
        "User-Agent": "Supabase-SMS-Gateway/1.0",
      },
      body: webhookPayload,
    });

    // Mark dispatched
    if (table === "inbound_messages") {
      await supabase
        .from("inbound_messages")
        .update({ webhook_dispatched_at: new Date().toISOString() })
        .eq("id", record.id);
    }

    return new Response(JSON.stringify({ delivered: response.ok, status: response.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
