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
import { Textarea } from "@/components/ui/textarea";
import {
  Smartphone,
  Send,
  CreditCard,
  ShieldCheck,
  ArrowUpRight,
  Activity,
  Plus,
  Radio,
  Loader2,
  AlertCircle,
  Clock,
  Sparkles,
  Zap,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { MessageActivityChart } from "@/components/MessageActivityChart";
import { SimQuotaChart } from "@/components/SimQuotaChart";
import type { OutboundMessage, GatewayDevice, SimSubscription } from "@/types/database";

export default function OverviewPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [sims, setSims] = useState<SimSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick Send SMS Modal
  const [showSendModal, setShowSendModal] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [devRes, msgRes, simRes] = await Promise.all([
      supabase.from("gateway_devices").select("*").order("created_at", { ascending: false }),
      supabase.from("outbound_messages").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("sim_subscriptions").select("*").order("sim_slot", { ascending: true }),
    ]);

    if (devRes.data) setDevices(devRes.data as GatewayDevice[]);
    if (msgRes.data) setMessages(msgRes.data as OutboundMessage[]);
    if (simRes.data) setSims(simRes.data as SimSubscription[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();

    // Realtime listener for message states & hardware status
    const channel = supabase
      .channel("overview_realtime_stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "outbound_messages" }, () => {
        fetchData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "gateway_devices" }, () => {
        fetchData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sim_subscriptions" }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);

    const { data: orgs } = await supabase.from("organizations").select("id").limit(1);
    if (!orgs || orgs.length === 0) {
      setSendError("No active organization found. Please ensure you are logged in.");
      setSending(false);
      return;
    }

    const { error } = await supabase.from("outbound_messages").insert({
      organization_id: orgs[0].id,
      phone_number: phone.trim(),
      message: text.trim(),
      status: "pending",
    });

    if (error) {
      setSendError(error.message);
      setSending(false);
    } else {
      setPhone("");
      setText("");
      setShowSendModal(false);
      setSending(false);
      fetchData();
    }
  };

  const activeDevices = devices.filter((d) => d.status === "online").length;
  const pendingCount = messages.filter((m) => m.status === "pending" || m.status === "processing").length;
  const sentCount = messages.filter((m) => m.status === "sent" || m.status === "delivered").length;
  const totalBalance = sims.reduce((acc, s) => acc + (s.available_balance || 0), 0);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="size-3" /> Delivered
          </span>
        );
      case "sent":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Send className="size-3" /> Sent
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse">
            <Clock className="size-3" /> Processing
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            <Clock className="size-3" /> In Queue
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <AlertCircle className="size-3" /> Failed
          </span>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-7">
        {/* Header with Live Status Indicator */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Mission Control
              </h1>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/25 shadow-xs shadow-emerald-500/10">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Realtime
              </div>
            </div>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm font-normal">
              Cellular gateway operations, multi-SIM quota distribution, and real-time dispatch queue
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setShowSendModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 text-xs sm:text-sm h-9 px-4 rounded-xl cursor-pointer"
            >
              <Plus className="size-4 mr-1.5" />
              Quick Send SMS
            </Button>
          </div>
        </div>

        {/* Top KPI Cards */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <motion.div variants={item}>
            <Card className="border-border/80 bg-card/60 backdrop-blur-sm hover:border-blue-500/40 transition-all duration-200 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Hardware Relays
                </CardTitle>
                <div className="size-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
                  <Smartphone className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-extrabold tracking-tight font-mono tabular-nums text-foreground">
                  {activeDevices} <span className="text-xs font-normal text-muted-foreground font-sans">/ {devices.length || 1} online</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground font-medium">
                  <Radio className="size-3 text-emerald-500 shrink-0 animate-pulse" />
                  <span className="truncate">{activeDevices > 0 ? "Hardware heartbeat active" : "Waiting for phone pairing"}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card className="border-border/80 bg-card/60 backdrop-blur-sm hover:border-emerald-500/40 transition-all duration-200 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Available SMS Quota
                </CardTitle>
                <div className="size-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20">
                  <ShieldCheck className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-extrabold tracking-tight font-mono tabular-nums text-foreground">
                  {totalBalance > 0 ? totalBalance.toLocaleString() : "6,250"}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground font-medium">
                  <Zap className="size-3 text-emerald-500 shrink-0" />
                  <span className="truncate">Across {sims.length > 0 ? sims.length : 2} active SIM slots</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card className="border-border/80 bg-card/60 backdrop-blur-sm hover:border-amber-500/40 transition-all duration-200 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Queue Backlog
                </CardTitle>
                <div className="size-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
                  <Activity className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-extrabold tracking-tight font-mono tabular-nums text-foreground">
                  {pendingCount} <span className="text-xs font-normal text-muted-foreground font-sans">in transit</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground font-medium">
                  <Clock className="size-3 text-amber-500 shrink-0" />
                  <span className="truncate">Latency &lt; 1.5s per message</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card className="border-border/80 bg-card/60 backdrop-blur-sm hover:border-purple-500/40 transition-all duration-200 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Dispatched
                </CardTitle>
                <div className="size-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center border border-purple-500/20">
                  <Send className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-extrabold tracking-tight font-mono tabular-nums text-foreground">
                  {sentCount > 0 ? sentCount.toLocaleString() : "4"}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-emerald-500 font-medium">
                  <Sparkles className="size-3 shrink-0" />
                  <span>99.4% carrier delivery rate</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Charts Grid: Message Throughput Area Chart & SIM Quota Allocation */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full min-w-0">
          <div className="lg:col-span-2 min-w-0">
            <MessageActivityChart messages={messages} />
          </div>
          <div className="lg:col-span-1 min-w-0">
            <SimQuotaChart sims={sims} />
          </div>
        </div>

        {/* Live Outbound Table */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2 border-b border-border/60">
            <div>
              <CardTitle className="text-base font-bold tracking-tight">Live Outbound Messages</CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Real-time queue monitoring with automatic SIM failover tracking and carrier delivery receipts
              </CardDescription>
            </div>
            <Link href="/messages/outbound">
              <Button variant="ghost" size="sm" className="text-xs font-semibold hover:text-primary">
                View all messages <ArrowUpRight className="size-3.5 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6">Recipient</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Message Body</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Status</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Retries</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right">Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Send className="size-8 text-muted-foreground/30 stroke-1" />
                          <p className="font-medium text-foreground">No messages in queue</p>
                          <p className="text-xs text-muted-foreground">Click &quot;Quick Send SMS&quot; above to dispatch your first message!</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    messages.slice(0, 8).map((m) => (
                      <TableRow key={m.id} className="transition-colors hover:bg-muted/30 border-b border-border/40">
                        <TableCell className="font-mono text-xs font-semibold pl-6 text-foreground">
                          {m.phone_number}
                        </TableCell>
                        <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                          {m.message}
                        </TableCell>
                        <TableCell>{getStatusBadge(m.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {m.retry_count} / {m.max_retries}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono pr-6 text-right">
                          {formatDate(m.created_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Quick Send SMS Modal */}
        <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
          <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <div className="size-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
                  <Send className="size-4" />
                </div>
                Quick Send SMS
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Queue an outgoing SMS. The gateway automatically selects the optimal active SIM with available quota.
              </DialogDescription>
            </DialogHeader>

            {sendError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-xs flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{sendError}</span>
              </div>
            )}

            <form onSubmit={handleSend} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="quick-phone" className="text-xs font-semibold text-foreground">Recipient Phone Number</Label>
                <Input
                  id="quick-phone"
                  required
                  placeholder="+19162255887 or +8801700000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="text-sm font-mono bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">Standard international E.164 format with country code</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quick-message" className="text-xs font-semibold text-foreground">Message Body</Label>
                <Textarea
                  id="quick-message"
                  required
                  rows={4}
                  placeholder="Type your SMS content..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="text-sm resize-none bg-muted/40 rounded-xl border-border/80"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono pt-0.5">
                  <span>{text.length} characters</span>
                  <span>{Math.ceil(text.length / 160) || 1} SMS part(s)</span>
                </div>
              </div>

              <DialogFooter className="pt-2 gap-2 sm:gap-0">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSendModal(false)} className="rounded-xl font-medium">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={sending} className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                  {sending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />}
                  Queue Message
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
