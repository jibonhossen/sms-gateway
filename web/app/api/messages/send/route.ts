import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWakeUpFcmToDevices } from "@/lib/fcm";

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { phoneNumber, message, requestedSimSlot } = body;

    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: "Recipient phone number and message body are required." },
        { status: 400 }
      );
    }

    // Get default organization
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .limit(1);

    if (orgError || !orgs || orgs.length === 0) {
      return NextResponse.json(
        { error: "No organization found." },
        { status: 404 }
      );
    }

    const orgId = orgs[0].id;

    // Insert message into outbound_messages queue
    const { data: insertedMsg, error: insertError } = await supabase
      .from("outbound_messages")
      .insert({
        organization_id: orgId,
        phone_number: phoneNumber.trim(),
        message: message.trim(),
        requested_sim_slot: requestedSimSlot ?? null,
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

    // Query devices in organization with FCM tokens
    const { data: devices } = await supabase
      .from("gateway_devices")
      .select("fcm_token")
      .eq("organization_id", orgId)
      .not("fcm_token", "is", null);

    const fcmTokens = devices?.map((d) => d.fcm_token) || [];

    // Trigger asynchronous out-of-band FCM wake-up
    if (fcmTokens.length > 0) {
      // Fire wake push in background without blocking API response
      sendWakeUpFcmToDevices(fcmTokens).catch((err) => {
        console.error("[API] FCM push wake-up failed:", err);
      });
    }

    return NextResponse.json({
      success: true,
      message: insertedMsg,
      fcmDispatchedCount: fcmTokens.length,
    });
  } catch (err) {
    console.error("[API] Error processing send SMS request:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
