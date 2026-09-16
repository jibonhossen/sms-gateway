export { cn } from "cn";

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Returns true only if the device status is 'online' and sent a heartbeat within the last 90 seconds.
 */
export function isDeviceOnline(device: { status?: string; last_heartbeat_at?: string | null } | null | undefined): boolean {
  if (!device || device.status === "disabled") return false;
  if (!device.last_heartbeat_at) return false;
  const lastSeen = new Date(device.last_heartbeat_at).getTime();
  if (isNaN(lastSeen)) return false;
  const now = Date.now();
  // 90 seconds threshold (devices send heartbeats every 30 seconds)
  return now - lastSeen < 90_000;
}

export function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return formatDate(dateStr);
}

