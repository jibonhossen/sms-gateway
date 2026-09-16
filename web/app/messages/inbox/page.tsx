"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import {
  Inbox,
  RefreshCw,
  CheckCircle2,
  Clock,
  MessageSquare,
  ArrowDownLeft,
  Copy,
  Check,
  Eye,
  Smartphone,
  Webhook,
  Calendar,
  Hash,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { InboundMessage } from "@/types/database";

export default function InboxPage() {
  const supabase = createClient();
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<InboundMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<InboundMessage | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedSender, setCopiedSender] = useState(false);

  // P4: debounce realtime-triggered refetches
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      fetchInbox();
    }, 500);
  };

  const handleOpenDetails = (msg: InboundMessage) => {
    setActiveMessage(msg);
    setSelectedMessage(msg);
  };

  const handleCloseDetails = (open: boolean) => {
    if (!open) {
      setSelectedMessage(null);
    }
  };

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
          scheduleRefetch();
        }
      )
      .subscribe();

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const copyToClipboard = (text: string, type: "message" | "sender") => {
    navigator.clipboard.writeText(text);
    if (type === "message") {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } else {
      setCopiedSender(true);
      setTimeout(() => setCopiedSender(false), 2000);
    }
  };

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
          <Button
            variant="outline"
            size="sm"
            onClick={fetchInbox}
            className="rounded-xl text-xs font-semibold h-9 px-3.5 cursor-pointer border-border/80 hover:bg-muted/40"
          >
            <RefreshCw className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Inbox className="size-4 text-primary" />
              Incoming Messages
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Click any message row to view full text body, carrier SIM metadata, and webhook payload.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="w-full table-fixed min-w-[760px]">
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6 w-[180px]">Sender</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[360px]">Message Content</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[110px]">Receiving SIM</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[140px]">Webhook Delivery</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right w-[150px]">Received At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-14 text-muted-foreground text-sm">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <MessageSquare className="size-8 text-muted-foreground/30 stroke-1" />
                          <p className="font-semibold text-foreground">No inbound messages yet</p>
                          <p className="text-xs text-muted-foreground">
                            Any SMS received by your connected Android phone will appear here in real-time.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    messages.map((m) => (
                      <TableRow
                        key={m.id}
                        onClick={() => handleOpenDetails(m)}
                        className="transition-colors hover:bg-muted/40 border-b border-border/40 cursor-pointer group"
                      >
                        <TableCell className="font-mono text-xs font-semibold pl-6 text-foreground truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <ArrowDownLeft className="size-3 text-emerald-500 shrink-0" />
                            <span className="truncate">{m.sender}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-foreground/90 font-normal">
                          <div className="truncate font-sans max-w-[340px]" title={m.message}>
                            {m.message}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-muted text-foreground font-semibold inline-block">
                            SIM {m.sim_slot + 1}
                          </span>
                        </TableCell>
                        <TableCell>
                          {m.webhook_dispatched_at ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              <CheckCircle2 className="size-2.5" /> Dispatched
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                              <Clock className="size-2.5" /> Pending
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono pr-6 text-right whitespace-nowrap">
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

        {/* Full Inbound SMS Inspector Sheet */}
        <Sheet open={!!selectedMessage} onOpenChange={handleCloseDetails}>
          <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col justify-between overflow-y-auto">
            {activeMessage && (
              <>
                <SheetHeader className="p-6 pb-4">
                  <div className="flex items-center justify-between gap-2 pr-6">
                    <div className="flex items-center gap-2.5">
                      <div className="size-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                        <ArrowDownLeft className="size-4" />
                      </div>
                      <div>
                        <SheetTitle className="text-base font-bold text-foreground">
                          Inbound Message Details
                        </SheetTitle>
                        <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                          Received from cellular carrier SMSC
                        </SheetDescription>
                      </div>
                    </div>
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-muted text-foreground font-semibold">
                      SIM {activeMessage.sim_slot + 1} (Slot {activeMessage.sim_slot})
                    </span>
                  </div>
                </SheetHeader>

                <div className="flex-1 space-y-4 p-6 pt-2">
                  {/* Full Message Body Card */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span>Message Body</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(activeMessage.message, "message")}
                        className="h-6 px-2 text-[11px] text-primary hover:text-primary hover:bg-primary/10 rounded-md cursor-pointer"
                      >
                        {copiedText ? (
                          <>
                            <Check className="size-3 mr-1 text-emerald-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3 mr-1" />
                            Copy Text
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/80 text-foreground text-sm font-sans whitespace-pre-wrap break-words leading-relaxed select-text min-h-[120px] max-h-72 overflow-y-auto">
                      {activeMessage.message}
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground font-mono pt-0.5">
                      <span>{activeMessage.message.length} characters</span>
                      <span>{Math.ceil(activeMessage.message.length / 160) || 1} SMS part(s)</span>
                    </div>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Smartphone className="size-3 text-primary" />
                        Sender Number
                      </div>
                      <div className="font-mono text-xs font-bold text-foreground truncate flex items-center justify-between">
                        <span>{activeMessage.sender}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(activeMessage.sender, "sender")}
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {copiedSender ? <Check className="size-2.5 text-emerald-500" /> : <Copy className="size-2.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Calendar className="size-3 text-primary" />
                        Received Time
                      </div>
                      <div className="font-mono text-xs font-semibold text-foreground truncate">
                        {formatDate(activeMessage.received_at)}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Webhook className="size-3 text-primary" />
                        Webhook Forwarding
                      </div>
                      <div>
                        {activeMessage.webhook_dispatched_at ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
                            <CheckCircle2 className="size-3" /> Dispatched
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                            <Clock className="size-3" /> Pending Delivery
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Hash className="size-3 text-primary" />
                        Message UUID
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate" title={activeMessage.id}>
                        {activeMessage.id}
                      </div>
                    </div>
                  </div>
                </div>

                <SheetFooter className="p-6 pt-4 border-t border-border/60 bg-muted/20">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCloseDetails(false)}
                    className="w-full rounded-xl font-semibold cursor-pointer border-border/80"
                  >
                    Close Panel
                  </Button>
                </SheetFooter>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </DashboardLayout>
  );
}
