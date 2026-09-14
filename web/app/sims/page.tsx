"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, AlertTriangle, ShieldCheck, Edit2, RotateCcw, Loader2, CheckCircle2, Zap } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { SimSubscription, GatewayDevice } from "@/types/database";

export default function SimsPage() {
  const supabase = createClient();
  const [sims, setSims] = useState<SimSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSim, setSelectedSim] = useState<SimSubscription | null>(null);
  const [balanceInput, setBalanceInput] = useState<number>(0);
  const [dailyLimitInput, setDailyLimitInput] = useState<number>(500);
  const [expiresInput, setExpiresInput] = useState<string>("");
  const [updating, setUpdating] = useState(false);

  const fetchSims = async () => {
    setLoading(true);
    const [simRes, devRes] = await Promise.all([
      supabase.from("sim_subscriptions").select("*").order("sim_slot", { ascending: true }),
      supabase.from("gateway_devices").select("*"),
    ]);

    if (simRes.data) {
      const devMap = new Map((devRes.data || []).map((d) => [d.id, d]));
      const enriched = (simRes.data as SimSubscription[]).map((s) => ({
        ...s,
        gateway_devices: devMap.get(s.device_id) || null,
      }));
      setSims(enriched);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSims();

    const channel = supabase
      .channel("sims_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sim_subscriptions" }, () => {
        fetchSims();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const openEditModal = (sim: SimSubscription) => {
    setSelectedSim(sim);
    setBalanceInput(sim.available_balance);
    setDailyLimitInput(sim.daily_limit);
    setExpiresInput(sim.expires_at ? sim.expires_at.split("T")[0] : "");
  };

  const handleSaveSim = async () => {
    if (!selectedSim) return;
    setUpdating(true);

    const { error } = await supabase
      .from("sim_subscriptions")
      .update({
        available_balance: Number(balanceInput),
        daily_limit: Number(dailyLimitInput),
        expires_at: expiresInput ? new Date(expiresInput).toISOString() : null,
        status: Number(balanceInput) > 0 && selectedSim.status === "exhausted" ? "active" : selectedSim.status,
      })
      .eq("id", selectedSim.id);

    if (error) {
      alert("Error saving SIM: " + error.message);
    } else {
      setSelectedSim(null);
      fetchSims();
    }
    setUpdating(false);
  };

  const handleUnquarantine = async (simId: string) => {
    const { error } = await supabase
      .from("sim_subscriptions")
      .update({
        status: "active",
        consecutive_failures: 0,
        quarantined_reason: null,
      })
      .eq("id", simId);

    if (error) {
      alert("Error resetting quarantine: " + error.message);
    } else {
      fetchSims();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="size-2.5" /> Active
          </span>
        );
      case "quarantined":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <AlertTriangle className="size-2.5" /> Quarantined
          </span>
        );
      case "exhausted":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Zap className="size-2.5" /> Exhausted
          </span>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              SIM Quotas & Balance
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Configure cellular carrier package limits, track remaining SMS balances, and manage auto-quarantined slots
            </p>
          </div>
        </div>

        {/* Quarantined Alert */}
        {sims.some((s) => s.status === "quarantined") && (
          <Alert variant="destructive" className="rounded-2xl border-rose-500/30 bg-rose-500/10 text-rose-400">
            <AlertTriangle className="size-4 text-rose-500" />
            <AlertTitle className="font-bold text-rose-300">Carrier Failure Alert</AlertTitle>
            <AlertDescription className="text-xs text-rose-400/90">
              One or more SIM cards have been automatically quarantined due to repeated transmission failures.
              Review error reasons below and click &quot;Reset&quot; once resolved.
            </AlertDescription>
          </Alert>
        )}

        {/* SIM Table */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <CreditCard className="size-4 text-blue-500" />
              Active SIM Cards
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              The routing engine prioritizes SIMs by nearest expiration, then lowest remaining quota to balance wear
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6">Relay Device</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Slot</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Carrier / Number</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Available Balance</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Daily Pace</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Package Expiry</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Health Status</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                        No SIM subscriptions found. Pair an Android device to detect SIM slots.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sims.map((sim) => {
                      const dailyPct = Math.min(100, Math.round((sim.sent_today / Math.max(1, sim.daily_limit)) * 100));
                      return (
                        <TableRow key={sim.id} className="transition-colors hover:bg-muted/30 border-b border-border/40">
                          <TableCell className="font-semibold text-xs pl-6 text-foreground">
                            {(sim.gateway_devices as GatewayDevice)?.name || "Gateway Alpha"}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
                              SIM {sim.sim_slot + 1}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs font-semibold text-foreground">{sim.carrier_name || "Cellular"}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{sim.phone_number || "No number assigned"}</div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono font-bold text-sm text-foreground tabular-nums">
                              {sim.available_balance.toLocaleString()}
                            </span>{" "}
                            <span className="text-[11px] text-muted-foreground">SMS</span>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 w-28">
                              <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
                                <span>{sim.sent_today}</span>
                                <span>/ {sim.daily_limit}</span>
                              </div>
                              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{ width: `${dailyPct}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {sim.expires_at ? formatDate(sim.expires_at) : "Indefinite"}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {getStatusBadge(sim.status)}
                              {sim.quarantined_reason && (
                                <p className="text-[10px] text-rose-500 max-w-xs truncate" title={sim.quarantined_reason}>
                                  {sim.quarantined_reason}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6 space-x-1">
                            {sim.status === "quarantined" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUnquarantine(sim.id)}
                                className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10 text-xs h-7 px-2.5 rounded-lg"
                              >
                                <RotateCcw className="size-3 mr-1" />
                                Reset
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditModal(sim)}
                              className="text-xs font-semibold hover:text-primary h-7 px-2.5 rounded-lg"
                            >
                              <Edit2 className="size-3 mr-1" />
                              Edit Quota
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Edit Quota Modal */}
        <Dialog open={!!selectedSim} onOpenChange={(open) => !open && setSelectedSim(null)}>
          <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <CreditCard className="size-4 text-blue-500" />
                Edit SIM Quota & Limits
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Update available balance and safety limits for SIM {selectedSim ? selectedSim.sim_slot + 1 : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="balance" className="text-xs font-semibold text-foreground">Available SMS Balance</Label>
                <Input
                  id="balance"
                  type="number"
                  min={0}
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(Number(e.target.value))}
                  className="text-sm font-mono bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">
                  Decremented for every SMS transmission confirmed by carrier
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dailyLimit" className="text-xs font-semibold text-foreground">Daily Safety Limit</Label>
                <Input
                  id="dailyLimit"
                  type="number"
                  min={1}
                  value={dailyLimitInput}
                  onChange={(e) => setDailyLimitInput(Number(e.target.value))}
                  className="text-sm font-mono bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">
                  Daily transmission cap to prevent carrier spam flagging
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expires" className="text-xs font-semibold text-foreground">Package Expiration Date (Optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={expiresInput}
                  onChange={(e) => setExpiresInput(e.target.value)}
                  className="text-sm bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">
                  SIMs with earlier expiration dates are exhausted first
                </p>
              </div>
            </div>

            <DialogFooter className="pt-2 gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setSelectedSim(null)} className="rounded-xl font-medium">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveSim} disabled={updating} className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                {updating && <Loader2 className="size-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
