import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { sendWakeUpFcmToDevices } from "@/lib/fcm";
import type { Database } from "@/types/database";

// C1 fix: this route is now fully authenticated and tenant-scoped.
// Previously it used SUPABASE_SERVICE_ROLE_KEY with `organizations.limit(1)`,
// letting any unauthenticated caller send SMS as the first tenant in the DB.

const E164_RE = /^\+[1-9]\d{6,14}$/;
const MAX_MESSAGE_LENGTH = 1600;

export async function POST(req: NextRequest) {
  try {
    // ---- 1. Authentication (C1) ----
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // ---- 2. Tenant resolution from membership (C1: never `limit(1)`) ----
    const { data: memberships, error: memberError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id);

    if (memberError || !memberships || memberships.length === 0) {
      return NextResponse.json(
        { error: "No organization membership found." },
        { status: 403 }
      );
    }

    // ---- 3. Input validation (H7) ----
    const body = await req.json();
    const { phoneNumber, message, requestedSimSlot, organizationId } = body ?? {};

    if (!phoneNumber || typeof phoneNumber !== "string" || !E164_RE.test(phoneNumber.trim())) {
      return NextResponse.json(
        { error: "phoneNumber must be an E.164 phone number, e.g. +19162255887." },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "message (text) is required." },
        { status: 400 }
      );
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `message exceeds ${MAX_MESSAGE_LENGTH} characters (max ~10 SMS parts).` },
        { status: 422 }
      );
    }
    let requestedSim: number | null = null;
    if (requestedSimSlot !== undefined && requestedSimSlot !== null) {
      const slot = Number(requestedSimSlot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 1) {
        return NextResponse.json(
          { error: "requestedSimSlot must be 0 or 1." },
          { status: 422 }
        );
      }
      requestedSim = slot;
    }

    // ---- 4. Insert with the USER-SCOPED client (RLS applies) ----
    const memberOrgIds = memberships.map((m) => m.organization_id);
    let orgId: string;
    if (organizationId) {
      if (!memberOrgIds.includes(organizationId)) {
        return NextResponse.json(
          { error: "Forbidden: you are not a member of this organization." },
          { status: 403 }
        );
      }
      orgId = organizationId;
    } else {
      orgId = memberOrgIds[0];
    }

    const { data: insertedMsg, error: insertError } = await supabase
      .from("outbound_messages")
      .insert({
        organization_id: orgId,
        phone_number: phoneNumber.trim(),
        message: message.trim(),
        requested_sim_slot: requestedSim,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !insertedMsg) {
      return NextResponse.json(
        { error: insertError?.message || "Failed to insert outbound message." },
        { status: 500 }
      );
    }

    // ---- 5. FCM wake-up + realtime broadcast (fan-out is service-role only) ----
    // The browser client cannot read other devices' FCM tokens, so the device
    // lookup uses a service-role client scoped to the verified org.
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: devices } = await serviceClient
      .from("gateway_devices")
      .select("id, fcm_token")
      .eq("organization_id", orgId)
      .not("fcm_token", "is", null);

    const fcmTokens = (devices?.map((d) => d.fcm_token) || []) as (string | null)[];

    if (fcmTokens.length > 0) {
      // Fire wake push in background without blocking the API response
      sendWakeUpFcmToDevices(fcmTokens)
        .then(({ deadTokens }) => {
          // P5: prune tokens FCM rejected as unregistered/invalid
          if (deadTokens.length > 0 && devices) {
            const deadIds = devices
              .filter((d) => d.fcm_token && deadTokens.includes(d.fcm_token))
              .map((d) => d.id);
            if (deadIds.length > 0) {
              serviceClient
                .from("gateway_devices")
                .update({ fcm_token: null })
                .in("id", deadIds)
                .then(({ error }) => {
                  if (error) console.error("[API] Failed to prune dead FCM tokens:", error.message);
                });
            }
          }
        })
        .catch((err) => {
          console.error("[API] FCM push wake-up failed:", err);
        });
    }

    // C3: instant realtime wake-up via public broadcast channel (not subject
    // to RLS row filters, unlike postgres_changes for the anon role).
    try {
      const channel = serviceClient.channel(`gateway_queue:${orgId}`);
      await channel.subscribe();
      await channel.send({
        type: "broadcast",
        event: "queue_updated",
        payload: { messageId: insertedMsg.id },
      });
      serviceClient.removeChannel(channel);
    } catch (e) {
      console.warn("[API] Realtime broadcast failed (queue remains poll-safe):", e);
    }

    return NextResponse.json({
      success: true,
      message: insertedMsg,
      fcmDispatchedCount: fcmTokens.length,
    });
  } catch (err) {
    console.error("[API] Error processing send SMS request:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

