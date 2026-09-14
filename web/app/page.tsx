"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Smartphone, Send, Inbox, ShieldCheck, ArrowUpRight, Activity } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import type { OutboundMessage, GatewayDevice, SimSubscription } from "@/types/database";

export default function OverviewPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [sims, setSims] = useState<SimSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [devRes, msgRes, simRes] = await Promise.all([
        supabase.from("gateway_devices").select("*").order("created_at", { ascending: false }),
        supabase.from("outbound_messages").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("sim_subscriptions").select("*"),
      ]);

      if (devRes.data) setDevices(devRes.data as GatewayDevice[]);
      if (msgRes.data) setMessages(msgRes.data as OutboundMessage[]);
      if (simRes.data) setSims(simRes.data as SimSubscription[]);
      setLoading(false);
    };

    fetchData();

    // Subscribe to Realtime changes on outbound_messages
    const channel = supabase
      .channel("overview_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "outbound_messages" }, () => {
        fetchData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "gateway_devices" }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeDevices = devices.filter((d) => d.status === "online").length;
  const pendingCount = messages.filter((m) => m.status === "pending" || m.status === "processing").length;
  const sentCount = messages.filter((m) => m.status === "sent" || m.status === "delivered").length;
  const totalBalance = sims.reduce((acc, s) => acc + (s.available_balance || 0), 0);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0 },
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Delivered</Badge>;
      case "sent":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Sent</Badge>;
      case "processing":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Processing</Badge>;
      case "pending":
        return <Badge className="bg-slate-500/10 text-slate-600 border-slate-500/20">Pending</Badge>;
      case "failed":
        return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/20">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
            <p className="text-muted-foreground mt-1">Live metrics and gateway device telemetry</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/messages/outbound">
              <Button>
                <Send className="size-4 mr-2" />
                Send SMS
              </Button>
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <motion.div variants={item}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Devices</CardTitle>
                <Smartphone className="size-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activeDevices} / {devices.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {activeDevices > 0 ? "Hardware relays connected" : "No devices online"}
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Available SMS Quota</CardTitle>
                <ShieldCheck className="size-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalBalance.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Across all active SIM cards</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">In Queue</CardTitle>
                <Activity className="size-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingCount}</div>
                <p className="text-xs text-muted-foreground mt-1">Pending transmission</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Recent Sent</CardTitle>
                <Send className="size-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{sentCount}</div>
                <p className="text-xs text-muted-foreground mt-1">Successfully dispatched</p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Live Outbound Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Outbound Messages</CardTitle>
              <CardDescription>Live streaming status updates from connected devices</CardDescription>
            </div>
            <Link href="/messages/outbound">
              <Button variant="ghost" size="sm">
                View all <ArrowUpRight className="size-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No messages sent yet. Click &quot;Send SMS&quot; to queue your first message!
                    </TableCell>
                  </TableRow>
                ) : (
                  messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.phone_number}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{m.message}</TableCell>
                      <TableCell>{getStatusBadge(m.status)}</TableCell>
                      <TableCell className="text-xs">{m.retry_count} / {m.max_retries}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
