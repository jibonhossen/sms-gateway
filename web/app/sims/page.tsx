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
import { CreditCard, AlertTriangle, ShieldCheck, Edit2, RotateCcw, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { SimSubscription, GatewayDevice } from "@/types/database";

export default function SimsPage() {
  const supabase = createClient();
  const [sims, setSims] = useState<SimSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSim, setSelectedSim] = useState<SimSubscription | null>(null);
  const [balanceInput, setBalanceInput] = useState<number>(0);
  const [dailyLimitInput, setDailyLimitInput] = useState<number>(200);
  const [expiresInput, setExpiresInput] = useState<string>("");
  const [updating, setUpdating] = useState(false);

  const fetchSims = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sim_subscriptions")
      .select("*, gateway_devices(*)")
      .order("created_at", { ascending: false });

    if (data) setSims(data as SimSubscription[]);
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
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Active</Badge>;
      case "quarantined":
        return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/20">Quarantined</Badge>;
      case "exhausted":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Exhausted</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SIM Quotas & Balance</h1>
          <p className="text-muted-foreground mt-1">
            Configure carrier package balances and manage auto-quarantined cards
          </p>
        </div>

        {/* Quarantined Notice */}
        {sims.some((s) => s.status === "quarantined") && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Carrier Failure Alert</AlertTitle>
            <AlertDescription>
              One or more SIM cards have been automatically quarantined due to repeated transmission failures.
              Review error reasons below and click &quot;Reset&quot; once resolved.
            </AlertDescription>
          </Alert>
        )}

        {/* SIM Table */}
        <Card>
          <CardHeader>
            <CardTitle>Configured SIM Subscriptions</CardTitle>
            <CardDescription>
              The system prioritizes SIMs by nearest expiry date, then lowest remaining balance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Carrier / Number</TableHead>
                  <TableHead>Available Balance</TableHead>
                  <TableHead>Today / Limit</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sims.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No SIM subscriptions found. Pair an Android device to detect SIM slots.
                    </TableCell>
                  </TableRow>
                ) : (
                  sims.map((sim) => (
                    <TableRow key={sim.id}>
                      <TableCell className="font-medium">
                        {(sim.gateway_devices as GatewayDevice)?.name || "Gateway Phone"}
                      </TableCell>
                      <TableCell>SIM {sim.sim_slot + 1}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{sim.carrier_name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{sim.phone_number || "No number"}</div>
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-base">{sim.available_balance.toLocaleString()}</span> SMS
                      </TableCell>
                      <TableCell className="text-xs">
                        {sim.sent_today} / {sim.daily_limit}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sim.expires_at ? formatDate(sim.expires_at) : "Indefinite"}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getStatusBadge(sim.status)}
                          {sim.quarantined_reason && (
                            <p className="text-[10px] text-rose-600 max-w-xs truncate" title={sim.quarantined_reason}>
                              {sim.quarantined_reason}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {sim.status === "quarantined" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnquarantine(sim.id)}
                            className="text-rose-600 border-rose-200 hover:bg-rose-50"
                          >
                            <RotateCcw className="size-3 mr-1" />
                            Reset
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(sim)}>
                          <Edit2 className="size-3 mr-1" />
                          Edit Quota
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Edit Quota Modal */}
        <Dialog open={!!selectedSim} onOpenChange={(open) => !open && setSelectedSim(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit SIM Quota & Limits</DialogTitle>
              <DialogDescription>
                Update available balance and daily rate limits for SIM {selectedSim ? selectedSim.sim_slot + 1 : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="balance">Available SMS Balance</Label>
                <Input
                  id="balance"
                  type="number"
                  min={0}
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  The system will decrement this counter for each successfully sent SMS.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dailyLimit">Daily Safety Limit</Label>
                <Input
                  id="dailyLimit"
                  type="number"
                  min={1}
                  value={dailyLimitInput}
                  onChange={(e) => setDailyLimitInput(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum messages allowed to be sent from this SIM per calendar day.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expires">Package Expiration Date (Optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={expiresInput}
                  onChange={(e) => setExpiresInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  SIMs with earlier expiration dates will be consumed first.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedSim(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveSim} disabled={updating}>
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
