"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Plus, Trash2, Copy, Check, Terminal, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { ApiKey } from "@/types/database";

export default function ApiKeysPage() {
  const supabase = createClient();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("api_keys")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setKeys(data as ApiKey[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    const { data: orgs } = await supabase.from("organizations").select("id").limit(1);
    if (!orgs || orgs.length === 0) {
      alert("No organization found");
      setCreating(false);
      return;
    }

    // Generate crypto random key
    const rawSecret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const plainApiKey = `gw_live_${rawSecret}`;
    const keyPrefix = plainApiKey.slice(0, 12) + "...";

    // Hash the key using SHA-256 for storage
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(plainApiKey));
    const keyHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { error } = await supabase.from("api_keys").insert({
      organization_id: orgs[0].id,
      name: keyName.trim(),
      key_prefix: keyPrefix,
      key_hash: keyHash,
    });

    if (error) {
      alert("Failed to create key: " + error.message);
    } else {
      setGeneratedKey(plainApiKey);
      fetchKeys();
    }
    setCreating(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key? External systems using it will be blocked.")) return;
    await supabase.from("api_keys").delete().eq("id", id);
    fetchKeys();
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
            <p className="text-muted-foreground mt-1">Authenticate external applications, backend servers, and webhooks</p>
          </div>
          <Button onClick={() => { setGeneratedKey(null); setKeyName(""); setShowCreateModal(true); }}>
            <Plus className="size-4 mr-2" />
            Create API Key
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Active API Keys</CardTitle>
            <CardDescription>
              Keys grant access to trigger SMS dispatch via Supabase Edge Functions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No API keys created yet. Click &quot;Create API Key&quot; to authenticate your backend.
                    </TableCell>
                  </TableRow>
                ) : (
                  keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-semibold">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs">{k.key_prefix}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(k.created_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(k.last_used_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(k.id)}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-4 mr-1" />
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Integration Guide */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="size-4 text-primary" />
              REST API Integration Example
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Send SMS directly from any external system using a standard cURL command:
            </p>
            <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed">
              curl -X POST &apos;https://botjxkpasvvwkwbwicaq.supabase.co/functions/v1/send-sms&apos; \<br />
              &nbsp;&nbsp;-H &apos;Authorization: Bearer gw_live_YOUR_API_KEY&apos; \<br />
              &nbsp;&nbsp;-H &apos;Content-Type: application/json&apos; \<br />
              &nbsp;&nbsp;-d &apos;&#123; &quot;to&quot;: &quot;+19162255887&quot;, &quot;message&quot;: &quot;Your OTP verification code is 849201&quot; &#125;&apos;
            </div>
          </CardContent>
        </Card>

        {/* Create Key Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                {generatedKey
                  ? "Make sure to copy your API key now. You will not be able to see it again!"
                  : "Give your API key a descriptive name (e.g. 'Production Backend' or 'Stripe Webhook')."}
              </DialogDescription>
            </DialogHeader>

            {generatedKey ? (
              <div className="space-y-4 py-4">
                <div className="p-3 bg-muted rounded-xl flex items-center justify-between border border-border">
                  <span className="font-mono text-xs break-all">{generatedKey}</span>
                  <Button size="sm" variant="ghost" onClick={() => handleCopy(generatedKey)}>
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => setShowCreateModal(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreateKey} className="space-y-4 py-4">
                <div className="space-y-1.5">
                  <Label htmlFor="keyName">Key Name</Label>
                  <Input
                    id="keyName"
                    required
                    placeholder="e.g. Production Backend"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating && <Loader2 className="size-4 mr-2 animate-spin" />}
                    Generate Secret Key
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
