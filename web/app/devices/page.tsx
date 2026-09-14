"use client";

import { useEffect, useState } from "react";
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
  Cpu
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate } from "@/lib/utils";
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

  const fetchDevices = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("gateway_devices")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setDevices(data as GatewayDevice[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchDevices();

    const channel = supabase
      .channel("devices_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "gateway_devices" }, () => {
        fetchDevices();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleStartPairing = async () => {
    setGeneratingQr(true);
    setPairingStatus("pending");

    const { data: orgs } = await supabase.from("organizations").select("id").limit(1);
    if (!orgs || orgs.length === 0) {
      alert("No organization found. Please relogin.");
      setGeneratingQr(false);
      return;
    }

    const orgId = orgs[0].id;
    const { data: session, error } = await supabase
      .from("device_pairing_sessions")
      .insert({ organization_id: orgId })
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
              const isOnline = device.status === "online";
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
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
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
                          <span className="text-foreground text-[11px]">
                            {formatDate(device.last_heartbeat_at)}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/60 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDevice(device.id)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs h-7 px-2.5 rounded-lg"
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

        {/* QR Pairing Modal */}
        <Dialog open={showQrModal} onOpenChange={setShowQrModal}>
          <DialogContent className="sm:max-w-md text-center bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-center text-lg font-bold tracking-tight">Pair Gateway Device</DialogTitle>
              <DialogDescription className="text-center text-xs text-muted-foreground">
                Open the Gateway app on your Android phone and scan this pairing code.
              </DialogDescription>
            </DialogHeader>

            <div className="py-5 flex flex-col items-center justify-center space-y-4">
              {pairingStatus === "claimed" ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center gap-2 text-emerald-500 py-8"
                >
                  <CheckCircle2 className="size-16" />
                  <span className="font-bold text-base">Device Paired Successfully!</span>
                </motion.div>
              ) : (
                pairingPayload && (
                  <div className="p-4 bg-white rounded-2xl shadow-md border border-white/20 ring-4 ring-black/5">
                    <QRCodeSVG value={pairingPayload} size={210} />
                  </div>
                )
              )}

              {pairingStatus === "pending" && (
                <p className="text-xs text-muted-foreground font-medium">
                  Valid for 10 minutes &middot; Waiting for scan...
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
