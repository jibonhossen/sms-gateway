"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { 
  Smartphone, 
  Battery, 
  BatteryCharging, 
  Wifi, 
  Signal, 
  QrCode, 
  RefreshCw, 
  Trash2,
  CheckCircle2,
  Loader2,
  Radio,
  Cpu,
  Copy,
  Check,
  KeyRound
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate, isDeviceOnline, formatTimeAgo } from "@/lib/utils";
import type { GatewayDevice } from "@/types/database";

export default function DevicesPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showQrModal, setShowQrModal] = useState(false);
  const [pairingPayload, setPairingPayload] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState<"pending" | "claimed">("pending");
  const [generatingQr, setGeneratingQr] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [, setTimerTick] = useState(Date.now());

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      fetchDevices();
    }, 500);
  };

  const fetchDevices = async () => {
    setLoading(true);
    // Stale-device sweeping is owned by pg_cron — no browser maintenance RPCs.
    const { data } = await supabase
      .from("gateway_devices")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setDevices(data as GatewayDevice[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchDevices();

    // Re-evaluate liveness every 5 seconds dynamically
    const interval = setInterval(() => {
      setTimerTick(Date.now());
    }, 5000);

    const channel = supabase
      .channel("devices_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "gateway_devices" }, () => {
        scheduleRefetch();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleStartPairing = async () => {
    setGeneratingQr(true);
    setPairingStatus("pending");
    setCopiedCode(false);

    // C1 fix: resolve the org from the logged-in user's membership — never
    // `organizations.limit(1)` (which is the first org in the whole DB).
    const { data: orgs, error: orgError } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

    if (orgError || !orgs || orgs.length === 0) {
      alert("No organization membership found. Please relogin.");
      setGeneratingQr(false);
      return;
    }

    const orgId = orgs[0].organization_id;
    // Generate a 6-digit human-friendly pairing code e.g. "849201"
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();

    const { data: session, error } = await supabase
      .from("device_pairing_sessions")
      .insert({ organization_id: orgId, pairing_code: randomCode })
      .select("id, pairing_code")
      .single();

    if (error || !session) {
      alert("Failed to create pairing session: " + error?.message);
      setGeneratingQr(false);
      return;
    }

    setPairingCode(session.pairing_code);

    const qrData = JSON.stringify({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      code: session.pairing_code,
    });

    setPairingPayload(qrData);
    setShowQrModal(true);
    setGeneratingQr(false);

    const sessionChannel = supabase
      .channel(`pairing_${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "device_pairing_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          if (payload.new.status === "claimed") {
            setPairingStatus("claimed");
            setTimeout(() => {
              setShowQrModal(false);
              fetchDevices();
            }, 1800);
          }
        }
      )
      .subscribe();
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm("Are you sure you want to disconnect this device?")) return;
    await supabase.from("gateway_devices").delete().eq("id", id);
    fetchDevices();
  };

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Gateway Relays
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Manage connected physical Android hardware relays and live telemetry heartbeats
            </p>
          </div>
          <Button
            onClick={handleStartPairing}
            disabled={generatingQr}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 text-xs sm:text-sm h-9 px-4 rounded-xl cursor-pointer"
          >
            {generatingQr ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <QrCode className="size-4 mr-1.5" />}
            Pair Android Device
          </Button>
        </div>

        {/* Devices Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <AnimatePresence>
            {devices.map((device) => {
              const isOnline = isDeviceOnline(device);
              return (
                <motion.div
                  key={device.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="relative overflow-hidden border-border/80 bg-card/70 backdrop-blur-sm hover:border-blue-500/40 transition-all duration-200 shadow-xs rounded-2xl">
                    <div
                      className={`absolute top-0 left-0 right-0 h-1 ${
                        isOnline ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-zinc-700"
                      }`}
                    />
                    <CardHeader className="flex flex-row items-start justify-between pb-3 pt-5">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20 shrink-0">
                          <Smartphone className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-sm font-bold text-foreground truncate tracking-tight">
                            {device.name}
                          </CardTitle>
                          <CardDescription className="text-[11px] font-mono text-muted-foreground mt-0.5">
                            ID: {device.id.slice(0, 8)}...
                          </CardDescription>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          isOnline
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-1">
                      {/* Telemetry Stats */}
                      <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-muted/40 border border-border/60 text-xs">
                        <div className="flex items-center gap-2">
                          {device.battery_charging ? (
                            <BatteryCharging className="size-4 text-emerald-500 shrink-0" />
                          ) : (
                            <Battery className="size-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-mono font-medium text-foreground">
                            {device.battery_level !== null ? `${device.battery_level}%` : "100%"}
                          </span>
                          {device.battery_charging && (
                            <span className="text-[10px] text-emerald-500 font-semibold">Chg</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Signal className="size-4 text-blue-500 shrink-0" />
                          <span className="font-medium text-foreground truncate">{device.network_type || "5G / Wi-Fi"}</span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground space-y-1.5 pt-1">
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-1.5">
                            <Cpu className="size-3 text-muted-foreground/70" /> OS / Client:
                          </span>
                          <span className="font-mono font-medium text-foreground text-[11px]">
                            {device.android_version || "Android 14"} &middot; v{device.app_version || "1.0.0"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="flex items-center gap-1.5">
                            <Radio className="size-3 text-muted-foreground/70" /> Last Ping:
                          </span>
                          <span className="text-foreground text-[11px] font-mono">
                            {device.last_heartbeat_at ? `${formatTimeAgo(device.last_heartbeat_at)} (${formatDate(device.last_heartbeat_at)})` : "Never"}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/60 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDevice(device.id)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs h-7 px-2.5 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="size-3.5 mr-1" />
                          Disconnect
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {devices.length === 0 && !loading && (
          <Card className="text-center py-16 border-dashed border-border/80 bg-card/40 rounded-2xl">
            <CardContent className="space-y-4">
              <div className="mx-auto size-12 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground border border-border/60">
                <Smartphone className="size-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-foreground">No Relays Connected</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                  Connect your Android phone to start relaying cellular SMS messages in real time.
                </p>
              </div>
              <Button onClick={handleStartPairing} className="rounded-xl font-semibold text-xs">
                <QrCode className="size-3.5 mr-1.5" />
                Pair Android Device
              </Button>
            </CardContent>
          </Card>
        )}

        {/* QR & Manual Pairing Code Modal */}
        <Dialog open={showQrModal} onOpenChange={setShowQrModal}>
          <DialogContent className="sm:max-w-lg text-center bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-3xl p-6 sm:p-7">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-center text-lg sm:text-xl font-bold tracking-tight text-foreground flex items-center justify-center gap-2">
                <Smartphone className="size-5 text-primary" />
                Pair Gateway Device
              </DialogTitle>
              <DialogDescription className="text-center text-xs text-muted-foreground">
                Connect your Android phone running SMS Gateway to start relaying cellular messages.
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 flex flex-col items-center justify-center space-y-4">
              {pairingStatus === "claimed" ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center gap-3 text-emerald-500 py-8"
                >
                  <div className="size-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="size-10" />
                  </div>
                  <span className="font-bold text-lg text-foreground">Device Paired Successfully!</span>
                  <p className="text-xs text-muted-foreground">Hardware relay is now active and ready.</p>
                </motion.div>
              ) : (
                <>
                  {/* Two Methods Container */}
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-muted/20 border border-border/60 p-4 rounded-2xl">
                    
                    {/* Method 1: QR Code */}
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="p-3 bg-white rounded-2xl shadow-sm border border-black/5 ring-4 ring-black/5">
                        {pairingPayload && <QRCodeSVG value={pairingPayload} size={140} />}
                      </div>
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground">
                          <QrCode className="size-3 text-primary" /> Method 1: Scan QR
                        </span>
                        <p className="text-[10px] text-muted-foreground">Point Gateway app camera</p>
                      </div>
                    </div>

                    {/* Method 2: Manual Pairing Code */}
                    <div className="flex flex-col items-center justify-center space-y-2.5 sm:border-l sm:border-border/60 sm:pl-4">
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground">
                          <KeyRound className="size-3 text-primary" /> Method 2: Pairing Code
                        </span>
                        <p className="text-[10px] text-muted-foreground">Type directly in the app</p>
                      </div>

                      {/* Monospace Code Display */}
                      <div className="w-full py-2.5 px-3 bg-background/90 rounded-xl border border-primary/30 flex items-center justify-center shadow-inner">
                        <span className="font-mono text-2xl font-black tracking-widest text-primary">
                          {pairingCode ? (pairingCode.length === 6 ? `${pairingCode.slice(0, 3)}-${pairingCode.slice(3)}` : pairingCode) : "------"}
                        </span>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (pairingCode) {
                            navigator.clipboard.writeText(pairingCode);
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2000);
                          }
                        }}
                        className="w-full h-8 text-xs font-semibold rounded-xl border-border/80 hover:border-primary/50 transition-colors"
                      >
                        {copiedCode ? (
                          <>
                            <Check className="size-3.5 mr-1.5 text-emerald-500" />
                            <span className="text-emerald-500">Copied Code</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5 mr-1.5" />
                            <span>Copy 6-Digit Code</span>
                          </>
                        )}
                      </Button>
                    </div>

                  </div>

                  {pairingStatus === "pending" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium pt-1">
                      <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                      <span>Code valid for 10 minutes &middot; Waiting for connection…</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
