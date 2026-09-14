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
  Loader2
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

  // Initiate QR Pairing Session
  const handleStartPairing = async () => {
    setGeneratingQr(true);
    setPairingStatus("pending");

    // Fetch tenant's organization id
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

    // Listen for session completion
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
    if (!confirm("Are you sure you want to remove this device?")) return;
    await supabase.from("gateway_devices").delete().eq("id", id);
    fetchDevices();
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Gateway Devices</h1>
            <p className="text-muted-foreground mt-1">Manage connected Android hardware relays</p>
          </div>
          <Button onClick={handleStartPairing} disabled={generatingQr}>
            {generatingQr ? <Loader2 className="size-4 mr-2 animate-spin" /> : <QrCode className="size-4 mr-2" />}
            Pair New Device
          </Button>
        </div>

        {/* Devices Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {devices.map((device) => {
              const isOnline = device.status === "online";
              return (
                <motion.div
                  key={device.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="relative overflow-hidden border-border">
                    <div
                      className={`absolute top-0 left-0 right-0 h-1.5 ${
                        isOnline ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    />
                    <CardHeader className="flex flex-row items-start justify-between pb-3">
                      <div>
                        <CardTitle className="text-lg font-semibold flex items-center gap-2">
                          <Smartphone className="size-5 text-primary" />
                          {device.name}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1 font-mono">
                          ID: {device.id.slice(0, 8)}...
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          isOnline
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                            : "bg-slate-500/10 text-slate-500 border-slate-500/20"
                        }
                      >
                        {isOnline ? "Online" : "Offline"}
                      </Badge>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-2">
                      {/* Telemetry Stats */}
                      <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/50 text-xs">
                        <div className="flex items-center gap-2">
                          {device.battery_charging ? (
                            <BatteryCharging className="size-4 text-emerald-500" />
                          ) : (
                            <Battery className="size-4 text-muted-foreground" />
                          )}
                          <span>
                            {device.battery_level !== null ? `${device.battery_level}%` : "Unknown"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Signal className="size-4 text-muted-foreground" />
                          <span>{device.network_type || "No Network"}</span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>App Version:</span>
                          <span className="font-mono">{device.app_version || "1.0.0"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Last Heartbeat:</span>
                          <span>{formatDate(device.last_heartbeat_at)}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDevice(device.id)}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                        >
                          <Trash2 className="size-4 mr-1" />
                          Remove
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
          <Card className="text-center py-12 border-dashed">
            <CardContent className="space-y-3">
              <div className="mx-auto size-12 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
                <Smartphone className="size-6" />
              </div>
              <h3 className="font-semibold text-lg">No Devices Connected</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Connect your first Android phone to start relaying cellular SMS messages.
              </p>
              <Button onClick={handleStartPairing}>
                <QrCode className="size-4 mr-2" />
                Pair Android Device
              </Button>
            </CardContent>
          </Card>
        )}

        {/* QR Pairing Modal */}
        <Dialog open={showQrModal} onOpenChange={setShowQrModal}>
          <DialogContent className="sm:max-w-md text-center">
            <DialogHeader>
              <DialogTitle className="text-center text-xl">Pair Gateway Device</DialogTitle>
              <DialogDescription className="text-center">
                Open the Gateway app on your Android phone and scan this QR code.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 flex flex-col items-center justify-center space-y-4">
              {pairingStatus === "claimed" ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center gap-2 text-emerald-600 py-8"
                >
                  <CheckCircle2 className="size-16" />
                  <span className="font-semibold text-lg">Device Paired Successfully!</span>
                </motion.div>
              ) : (
                pairingPayload && (
                  <div className="p-4 bg-white rounded-2xl shadow-inner border border-slate-200">
                    <QRCodeSVG value={pairingPayload} size={220} />
                  </div>
                )
              )}

              {pairingStatus === "pending" && (
                <p className="text-xs text-muted-foreground">
                  Valid for 10 minutes. Waiting for scan...
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
