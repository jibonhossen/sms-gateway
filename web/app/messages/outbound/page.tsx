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
import { Send, Plus, Loader2, RefreshCw, AlertCircle } from "lucide-react";
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Outbound SMS Queue</h1>
            <p className="text-muted-foreground mt-1">Live tracking of outgoing cellular messages</p>
          </div>
          <Button onClick={() => setShowSendModal(true)}>
            <Plus className="size-4 mr-2" />
            Send New SMS
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Messages History</CardTitle>
              <CardDescription>Real-time queue monitoring with automatic failover tracking</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchMessages}>
              <RefreshCw className="size-4 mr-1" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Error / Diagnostics</TableHead>
                  <TableHead>Sent At</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      No outbound messages in queue. Click &quot;Send New SMS&quot; to begin.
                    </TableCell>
                  </TableRow>
                ) : (
                  messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono font-medium">{m.phone_number}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{m.message}</TableCell>
                      <TableCell>{getStatusBadge(m.status)}</TableCell>
                      <TableCell className="text-xs">
                        {m.retry_count} / {m.max_retries}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate text-rose-600">
                        {m.error_message || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(m.sent_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Send SMS Modal */}
        <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send SMS Message</DialogTitle>
              <DialogDescription>
                Queue an Outbound Message for dispatch by the optimal active SIM card.
              </DialogDescription>
            </DialogHeader>

            {sendError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{sendError}</span>
              </div>
            )}

            <form onSubmit={handleSend} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Recipient Phone Number</Label>
                <Input
                  id="phone"
                  required
                  placeholder="+19162255887"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">E.164 format recommended (e.g. +19162255887)</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="message">Message Text</Label>
                <Textarea
                  id="message"
                  required
                  rows={4}
                  placeholder="Enter message text here..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{text.length} characters</span>
                  <span>{Math.ceil(text.length / 160) || 1} SMS part(s)</span>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowSendModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={sending}>
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
