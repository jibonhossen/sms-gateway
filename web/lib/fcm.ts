import crypto from "crypto";
import fs from "fs";
import path from "path";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      // Ignore parse error, fallback to file
    }
  }

  const filePath = path.join(process.cwd(), "firebase-service-account.json");
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      console.error("[FCM] Failed to read firebase-service-account.json:", e);
    }
  }

  return null;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = signer
    .sign(sa.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signatureInput}.${signature}`;
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: postData,
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to fetch Google OAuth2 token: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  };

  return data.access_token;
}

export async function sendWakeUpFcm(fcmToken: string): Promise<boolean> {
  const sa = getServiceAccount();
  if (!sa) {
    console.warn("[FCM] No service account configured. Skipping FCM push.");
    return false;
  }

  try {
    const accessToken = await getAccessToken(sa);
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    const payload = {
      message: {
        token: fcmToken,
        data: {
          action: "DRAIN_QUEUE",
          timestamp: Date.now().toString(),
        },
        android: {
          priority: "high",
          ttl: "86400s",
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[FCM] Push failed for token ${fcmToken.slice(0, 15)}...: ${errBody}`);
      return false;
    }

    console.log(`[FCM] High-priority wake-up push dispatched to ${fcmToken.slice(0, 15)}...`);
    return true;
  } catch (error) {
    console.error("[FCM] Error dispatching wake-up push:", error);
    return false;
  }
}

export async function sendWakeUpFcmToDevices(fcmTokens: (string | null | undefined)[]): Promise<void> {
  const validTokens = Array.from(new Set(fcmTokens.filter((t): t is string => Boolean(t && t.trim().length > 0))));
  if (validTokens.length === 0) return;

  await Promise.allSettled(validTokens.map((token) => sendWakeUpFcm(token)));
}
