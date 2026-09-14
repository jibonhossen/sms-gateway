"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Inbox, RefreshCw, CheckCircle2, Clock, MessageSquare, ArrowDownLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { InboundMessage } from "@/types/database";

export default function InboxPage() {
  const supabase = createClient();
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInbox = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("inbound_messages")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(100);

    if (data) setMessages(data as InboundMessage[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchInbox();

    const channel = supabase
      .channel("inbox_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbound_messages" },
        () => {
          fetchInbox();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Inbound SMS Inbox
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Real-time feed of received text messages intercepted by your Android gateway phones
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInbox} className="rounded-xl text-xs font-semibold h-9 px-3.5">
            <RefreshCw className="size-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>

        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Inbox className="size-4 text-blue-500" />
              Incoming Messages
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Messages received on physical SIMs are instantly stored in Supabase and forwarded to configured webhooks
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6">Sender</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Message Content</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Receiving SIM</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Webhook Delivery</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right">Received At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <MessageSquare className="size-8 text-muted-foreground/30 stroke-1" />
                          <p className="font-medium text-foreground">No inbound messages yet</p>
                          <p className="text-xs text-muted-foreground">Any SMS sent to your Android SIM number will stream here automatically.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    messages.map((m) => (
                      <TableRow key={m.id} className="transition-colors hover:bg-muted/30 border-b border-border/40">
                        <TableCell className="font-mono text-xs font-semibold pl-6 text-foreground">
                          <div className="flex items-center gap-1.5">
                            <ArrowDownLeft className="size-3 text-emerald-500" />
                            {m.sender}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md text-xs text-muted-foreground font-medium">
                          {m.message}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
                            SIM {m.sim_slot + 1}
                          </span>
                        </TableCell>
                        <TableCell>
                          {m.webhook_dispatched_at ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              <CheckCircle2 className="size-2.5" /> Dispatched
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                              <Clock className="size-2.5" /> Pending
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono pr-6 text-right">
                          {formatDate(m.received_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
