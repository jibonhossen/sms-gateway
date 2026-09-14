// Supabase Edge Function: send-sms (Public REST API for External Apps)
// Deploy with: supabase functions deploy send-sms --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Bearer API key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = authHeader.replace("Bearer ", "").trim();

    // Hash the API key using SHA-256 to compare with stored hash
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up organization by API key hash
    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("id, organization_id")
      .eq("key_hash", keyHash)
      .single();

    if (keyError || !keyData) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid API key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update last_used_at timestamp on API key
    await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyData.id);

    const body = await req.json();
    const { to, message, sim_slot } = body;

    if (!to || typeof to !== "string" || !message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid payload. 'to' (phone number) and 'message' (text) are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert into outbound queue
    const { data: inserted, error: insertError } = await supabase
      .from("outbound_messages")
      .insert({
        organization_id: keyData.organization_id,
        phone_number: to.trim(),
        message: message.trim(),
        requested_sim_slot: sim_slot !== undefined ? Number(sim_slot) : null,
        status: "pending",
      })
      .select("id, phone_number, message, status, created_at")
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "Failed to queue message", details: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: inserted.id,
        status: inserted.status,
        to: inserted.phone_number,
        createdAt: inserted.created_at,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal Server Error", details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
