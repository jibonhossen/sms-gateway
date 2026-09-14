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
import { Send, Plus, Loader2, RefreshCw, AlertCircle, CheckCircle2, Clock, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { OutboundMessage } from "@/types/database";

export default function OutboundMessagesPage() {
  const supabase = createClient();
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendModal, setShowSendModal] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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

    const { data: orgs } = await supabase.from("organizations").select("id").limit(1);
    if (!orgs || orgs.length === 0) {
      setSendError("No organization found. Please log in.");
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
      fetchMessages();
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
              Live transmission feed and carrier delivery receipt tracking
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
              placeholder="Filter by phone or text..."
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
                className="h-7 text-xs px-2.5 rounded-lg capitalize font-medium"
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={fetchMessages} className="h-7 text-xs px-2 rounded-lg">
              <RefreshCw className="size-3" />
            </Button>
          </div>
        </div>

        {/* Messages Table */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight">Transmission History</CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Real-time message state transitions reported directly by hardware phones
            </CardDescription>
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
                    <TableHead className="font-semibold text-xs py-3">Error Diagnostics</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMessages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                        No matching messages found in outbound queue.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMessages.map((m) => (
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
                        <TableCell className="text-xs max-w-xs truncate text-rose-500 font-mono">
                          {m.error_message || "-"}
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

        {/* Send SMS Modal */}
        <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
          <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl">
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
                <Label htmlFor="phone" className="text-xs font-semibold text-foreground">Recipient Phone Number</Label>
                <Input
                  id="phone"
                  required
                  placeholder="+19162255887 or +8801700000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="text-sm font-mono bg-muted/40 rounded-xl border-border/80"
                />
                <p className="text-[11px] text-muted-foreground">Standard international E.164 format with country code</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="message" className="text-xs font-semibold text-foreground">Message Body</Label>
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
