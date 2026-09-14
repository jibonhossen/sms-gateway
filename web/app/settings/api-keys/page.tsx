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
import { Key, Plus, Trash2, Copy, Check, Terminal, Loader2, ShieldCheck } from "lucide-react";
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
  const [snippetCopied, setSnippetCopied] = useState(false);
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

    const rawSecret = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const plainApiKey = `gw_live_${rawSecret}`;
    const keyPrefix = plainApiKey.slice(0, 12) + "...";

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

  const handleCopySnippet = (snippet: string) => {
    navigator.clipboard.writeText(snippet);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key? External backends using it will be denied.")) return;
    await supabase.from("api_keys").delete().eq("id", id);
    fetchKeys();
  };

  const curlExample = `curl -X POST 'https://botjxkpasvvwkwbwicaq.supabase.co/functions/v1/send-sms' \\
  -H 'Authorization: Bearer gw_live_YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "to": "+19162255887",
    "message": "Your verification security code is 849201"
  }'`;

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              API Keys & Authentication
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Authenticate backend servers, microservices, and CRM workflows to dispatch SMS via REST API
            </p>
          </div>
          <Button
            onClick={() => { setGeneratedKey(null); setKeyName(""); setShowCreateModal(true); }}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md shadow-primary/20 text-xs sm:text-sm h-9 px-4 rounded-xl cursor-pointer"
          >
            <Plus className="size-4 mr-1.5" />
            Create API Key
          </Button>
        </div>

        {/* API Keys Table */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Key className="size-4 text-blue-500" />
              Active Secret Keys
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Secret keys are hashed using SHA-256 before storage. Only prefixes are visible once created.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/60 bg-muted/20 hover:bg-muted/20">
                    <TableHead className="font-semibold text-xs py-3 pl-6">Label / Client</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Key Prefix</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Created Date</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Last Used</TableHead>
                    <TableHead className="font-semibold text-xs py-3 pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                        No API keys generated yet. Click &quot;Create API Key&quot; above to integrate your server.
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((k) => (
                      <TableRow key={k.id} className="transition-colors hover:bg-muted/30 border-b border-border/40">
                        <TableCell className="font-semibold text-xs pl-6 text-foreground">
                          {k.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          <span className="bg-muted/60 px-2 py-0.5 rounded-md border border-border/60">
                            {k.key_prefix}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatDate(k.created_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {k.last_used_at ? formatDate(k.last_used_at) : "Never used"}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(k.id)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs h-7 px-2.5 rounded-lg"
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Integration Guide */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Terminal className="size-4 text-emerald-500" />
                REST API Integration Example
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Send SMS directly from Node.js, Python, Go, PHP, or curl using your generated API key
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopySnippet(curlExample)}
              className="text-xs font-semibold h-8 rounded-lg"
            >
              {snippetCopied ? <Check className="size-3 mr-1 text-emerald-500" /> : <Copy className="size-3 mr-1" />}
              {snippetCopied ? "Copied" : "Copy cURL"}
            </Button>
          </CardHeader>
          <CardContent className="p-4">
            <pre className="p-4 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-200 font-mono text-xs overflow-x-auto leading-relaxed">
              <code>{curlExample}</code>
            </pre>
          </CardContent>
        </Card>

        {/* Create Key Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Key className="size-4 text-blue-500" />
                Create API Secret Key
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {generatedKey
                  ? "Make sure to copy your API key now. It will never be shown again!"
                  : "Give your secret key a clear label indicating which application or backend will use it."}
              </DialogDescription>
            </DialogHeader>

            {generatedKey ? (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-muted/40 rounded-xl flex items-center justify-between border border-border/80 gap-2">
                  <span className="font-mono text-xs break-all select-all text-foreground font-semibold">
                    {generatedKey}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => handleCopy(generatedKey)} className="rounded-lg shrink-0">
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p className="text-[11px] text-amber-500 font-medium">
                  Warning: If you lose this key, you will have to generate a new one.
                </p>
                <DialogFooter className="pt-2">
                  <Button onClick={() => setShowCreateModal(false)} className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreateKey} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="keyName" className="text-xs font-semibold text-foreground">Key Label</Label>
                  <Input
                    id="keyName"
                    required
                    placeholder="e.g. Production Backend / Shopify Webhook"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="text-sm bg-muted/40 rounded-xl border-border/80"
                  />
                </div>
                <DialogFooter className="pt-2 gap-2 sm:gap-0">
                  <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} className="rounded-xl font-medium">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating} className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
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
