"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Webhook, Copy, Check, Save, Shield, Loader2, Code2, Send } from "lucide-react";
import type { Organization } from "@/types/database";

export default function WebhooksPage() {
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const fetchOrg = async () => {
    setLoading(true);
    const { data } = await supabase.from("organizations").select("*").limit(1).single();
    if (data) {
      setOrg(data as Organization);
      setWebhookUrl(data.webhook_url || "");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrg();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    setSavedSuccess(false);

    const { error } = await supabase
      .from("organizations")
      .update({
        webhook_url: webhookUrl.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", org.id);

    if (error) {
      alert("Error updating webhook: " + error.message);
    } else {
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      fetchOrg();
    }
    setSaving(false);
  };

  const handleCopySecret = () => {
    if (!org?.webhook_secret) return;
    navigator.clipboard.writeText(org.webhook_secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const verifySnippet = `import crypto from "crypto";

app.post("/webhooks/sms", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-gateway-signature"]; // e.g. "sha256=abc..."
  const expectedSig = "sha256=" + crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return res.status(401).send("Invalid signature");
  }

  const payload = JSON.parse(req.body);
  console.log("SMS Event:", payload.event, payload.data);
  res.sendStatus(200);
});`;

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Webhook Dispatch
            </h1>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              Stream real-time incoming SMS and carrier delivery status events directly into your application
            </p>
          </div>
        </div>

        {/* Webhook Configuration Form */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Webhook className="size-4 text-blue-500" />
              Webhook Endpoint Destination
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              We send signed HTTP POST requests with JSON event payloads whenever an SMS arrives or delivery status transitions
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSave}>
            <CardContent className="space-y-6 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="url" className="text-xs font-semibold text-foreground">Payload Endpoint URL</Label>
                <div className="relative">
                  <Webhook className="size-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://api.yourdomain.com/webhooks/sms"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="pl-9 text-sm bg-muted/40 rounded-xl border-border/80"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Must be a publicly accessible HTTPS endpoint returning HTTP 200 OK within 5 seconds.
                </p>
              </div>

              {/* Secret Signing Key */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <Label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Shield className="size-4 text-emerald-500" />
                  HMAC SHA-256 Signing Secret
                </Label>
                <div className="p-3 bg-muted/40 rounded-xl flex items-center justify-between border border-border/80 gap-2">
                  <span className="font-mono text-xs text-foreground select-all font-semibold">
                    {org?.webhook_secret || "Generating secret..."}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleCopySecret}
                    disabled={!org?.webhook_secret}
                    className="rounded-lg shrink-0"
                  >
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Every request contains an <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">X-Gateway-Signature</code> header
                  computed as HMAC SHA-256 with this secret.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between items-center border-t border-border/60 p-6 pt-4">
              <span className="text-xs text-emerald-500 font-semibold">
                {savedSuccess && "✓ Webhook settings saved successfully!"}
              </span>
              <Button type="submit" disabled={saving} className="rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                Save Changes
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Verification Example */}
        <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Code2 className="size-4 text-blue-500" />
                Signature Verification Snippet (Node.js / Express)
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Verify authenticity to ensure notifications genuinely originated from your SMS Gateway
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(verifySnippet);
                setSnippetCopied(true);
                setTimeout(() => setSnippetCopied(false), 2000);
              }}
              className="text-xs font-semibold h-8 rounded-lg"
            >
              {snippetCopied ? <Check className="size-3 mr-1 text-emerald-500" /> : <Copy className="size-3 mr-1" />}
              {snippetCopied ? "Copied" : "Copy Code"}
            </Button>
          </CardHeader>
          <CardContent className="p-4">
            <pre className="p-4 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-200 font-mono text-xs overflow-x-auto leading-relaxed">
              <code>{verifySnippet}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
