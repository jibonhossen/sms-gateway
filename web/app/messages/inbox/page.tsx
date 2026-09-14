"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Inbox, RefreshCw, CheckCircle2, Clock } from "lucide-react";
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
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inbound SMS Inbox</h1>
            <p className="text-muted-foreground mt-1">Live feed of received text messages from all gateway devices</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInbox}>
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Received Messages</CardTitle>
            <CardDescription>
              Incoming SMS intercepted by Android devices and synced instantly to Supabase
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Receiving Slot</TableHead>
                  <TableHead>Webhook Dispatched</TableHead>
                  <TableHead>Received Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      No inbound messages yet. Messages sent to your gateway phone SIM will appear here in real time.
                    </TableCell>
                  </TableRow>
                ) : (
                  messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono font-medium">{m.sender}</TableCell>
                      <TableCell className="max-w-md text-sm">{m.message}</TableCell>
                      <TableCell>
                        <Badge variant="outline">SIM {m.sim_slot + 1}</Badge>
                      </TableCell>
                      <TableCell>
                        {m.webhook_dispatched_at ? (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                            <CheckCircle2 className="size-3.5" /> Dispatched
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Clock className="size-3.5" /> Pending
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(m.received_at)}</TableCell>
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
