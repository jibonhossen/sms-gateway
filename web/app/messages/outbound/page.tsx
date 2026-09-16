"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Plus,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Copy,
  Check,
  Smartphone,
  Calendar,
  Hash,
  RotateCcw,
  Activity,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { OutboundMessage } from "@/types/database";

export default function OutboundMessagesPage() {
  const supabase = createClient();
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<OutboundMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<OutboundMessage | null>(null);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedText, setCopiedText] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  const handleOpenDetails = (msg: OutboundMessage) => {
    setActiveMessage(msg);
    setSelectedMessage(msg);
  };

  const handleCloseDetails = (open: boolean) => {
    if (!open) {
      setSelectedMessage(null);
    }
  };

  const fetchMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("outbound_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (data) setMessages(data as OutboundMessage[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel("outbound_page_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outbound_messages" },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone.trim(),
          message: text.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error || "Failed to queue outbound message.");
        setSending(false);
        return;
      }

      setPhone("");
      setText("");
      setShowSendModal(false);
      setSending(false);
      fetchMessages();
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : "Network error occurred.");
      setSending(false);
    }
  };

  const copyToClipboard = (textToCopy: string, type: "message" | "phone") => {
    navigator.clipboard.writeText(textToCopy);
    if (type === "message") {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } else {
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const filteredMessages = messages.filter((m) => {
    const matchesSearch =
      m.phone_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="size-2.5" /> Delivered
          </span>
        );
      case "sent":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Send className="size-2.5" /> Sent
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse">
            <Clock className="size-2.5" /> Processing
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            <Clock className="size-2.5" /> In Queue
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <AlertCircle className="size-2.5" /> Failed
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
              Outbound SMS Queue
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Live transmission feed, carrier delivery receipt tracking, and diagnostics
            </p>
          </div>
          <Button
            onClick={() => setShowSendModal(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 text-xs sm:text-sm h-9 px-4 rounded-xl cursor-pointer"
          >
            <Plus className="size-4 mr-1.5" />
            Send New SMS
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Filter by phone or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs bg-card/60 rounded-xl border-border/80 h-9"
            />
          </div>

          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/60 w-full sm:w-auto overflow-x-auto">
            {["all", "delivered", "sent", "pending", "failed"].map((st) => (
              <Button
                key={st}
                variant={statusFilter === st ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5 rounded-lg capitalize font-medium cursor-pointer"
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={fetchMessages} className="h-7 text-xs px-2 rounded-lg cursor-pointer">
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Messages Table */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight">Transmission History</CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Click any message row to view full text body, dispatch timestamps, and cellular diagnostics.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="w-full table-fixed min-w-[760px]">
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6 w-[170px]">Recipient</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[330px]">Message Body</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[120px]">Status</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[90px]">Retries</TableHead>
                    <TableHead className="font-semibold text-xs py-3 w-[160px]">Error Diagnostics</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right w-[140px]">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMessages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-14 text-muted-foreground text-sm">
                        No matching messages found in outbound queue.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMessages.map((m) => (
                      <TableRow
                        key={m.id}
                        onClick={() => handleOpenDetails(m)}
                        className="transition-colors hover:bg-muted/40 border-b border-border/40 cursor-pointer group"
                      >
                        <TableCell className="font-mono text-xs font-semibold pl-6 text-foreground truncate">
                          {m.phone_number}
                        </TableCell>
                        <TableCell className="text-xs text-foreground/90 font-normal">
                          <div className="truncate font-sans max-w-[310px]" title={m.message}>
                            {m.message}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(m.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {m.retry_count} / {m.max_retries}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-rose-500 truncate">
                          <span className="truncate block max-w-[150px]" title={m.error_message || ""}>
                            {m.error_message || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono pr-6 text-right whitespace-nowrap">
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

        {/* Full Outbound SMS Inspector Sheet */}
        <Sheet open={!!selectedMessage} onOpenChange={handleCloseDetails}>
          <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col justify-between overflow-y-auto">
            {activeMessage && (
              <>
                <SheetHeader className="p-6 pb-4">
                  <div className="flex items-center justify-between gap-2 pr-6">
                    <div className="flex items-center gap-2.5">
                      <div className="size-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Send className="size-4" />
                      </div>
                      <div>
                        <SheetTitle className="text-base font-bold text-foreground">
                          Outbound Message Details
                        </SheetTitle>
                        <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                          Cellular transmission parameters and delivery receipt
                        </SheetDescription>
                      </div>
                    </div>
                    {getStatusBadge(activeMessage.status)}
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

                  {/* Diagnostic Alert if Failed */}
                  {activeMessage.error_message && (
                    <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-xs flex items-start gap-2.5">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-semibold">Carrier / Radio Error Diagnostic</p>
                        <p className="font-mono text-[11px] text-rose-400">{activeMessage.error_message}</p>
                      </div>
                    </div>
                  )}

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Smartphone className="size-3 text-primary" />
                        Recipient Number
                      </div>
                      <div className="font-mono text-xs font-bold text-foreground truncate flex items-center justify-between">
                        <span>{activeMessage.phone_number}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(activeMessage.phone_number, "phone")}
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {copiedPhone ? <Check className="size-2.5 text-emerald-500" /> : <Copy className="size-2.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <RotateCcw className="size-3 text-primary" />
                        Failover Retries
                      </div>
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {activeMessage.retry_count} / {activeMessage.max_retries} attempts
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-muted/20 border border-border/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Calendar className="size-3 text-primary" />
                        Created Time
                      </div>
                      <div className="font-mono text-xs font-semibold text-foreground truncate">
                        {formatDate(activeMessage.created_at)}
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

        {/* Send SMS Modal */}
        <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
          <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Send className="size-4 text-primary" /> Send Outbound SMS
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Queue an outgoing SMS for transmission by the optimal active SIM card.
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
                <Label htmlFor="phone" className="text-xs font-semibold text-foreground">
                  Recipient Phone Number
                </Label>
                <Input
                  id="phone"
                  required
                  placeholder="+8801308565614 or 01308565614"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="text-sm font-mono bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">Standard international or local mobile format</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="message" className="text-xs font-semibold text-foreground">
                  Message Body
                </Label>
                <Textarea
                  id="message"
                  required
                  rows={4}
                  placeholder="Type your SMS message..."
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSendModal(false)}
                  className="rounded-xl font-medium cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={sending}
                  className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer"
                >
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
