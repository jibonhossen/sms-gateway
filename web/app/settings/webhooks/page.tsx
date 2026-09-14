"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Webhook, Copy, Check, Save, Shield, Loader2, Code2 } from "lucide-react";
import type { Organization } from "@/types/database";

export default function WebhooksPage() {
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
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

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhook Notifications</h1>
          <p className="text-muted-foreground mt-1">
            Stream incoming SMS and delivery status updates to your application in real time
          </p>
        </div>

        {/* Webhook Configuration Form */}
        <Card>
          <CardHeader>
            <CardTitle>Endpoint Destination</CardTitle>
            <CardDescription>
              We will send HTTP POST requests with event payloads whenever an SMS arrives or changes status.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSave}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="url">Payload URL</Label>
                <div className="relative">
                  <Webhook className="size-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://api.yourdomain.com/webhooks/sms"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Must be a publicly accessible HTTPS endpoint capable of returning a 200 OK status.
                </p>
              </div>

              {/* Secret Signing Key */}
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="flex items-center gap-1.5">
                  <Shield className="size-4 text-primary" />
                  HMAC Signing Secret
                </Label>
                <div className="p-3 bg-muted rounded-xl flex items-center justify-between border border-border">
                  <span className="font-mono text-xs text-foreground">
                    {org?.webhook_secret || "Generating secret..."}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleCopySecret}
                    disabled={!org?.webhook_secret}
                  >
                    {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Each payload includes an <code className="bg-muted px-1.5 py-0.5 rounded font-mono">X-Gateway-Signature</code> header
                  computed as an HMAC SHA-256 hash using this secret.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between border-t pt-4">
              <span className="text-xs text-emerald-600 font-medium">
                {savedSuccess && "✓ Webhook settings saved successfully!"}
              </span>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                Save Changes
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Verification Example */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code2 className="size-4 text-primary" />
              Signature Verification Example (Node.js / Express)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed">
              {`import crypto from "crypto";

app.post("/webhooks/sms", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-gateway-signature"]; // "sha256=..."
  const expectedSig = "sha256=" + crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return res.status(401).send("Invalid signature");
  }

  const payload = JSON.parse(req.body);
  console.log("SMS Event Received:", payload.event, payload.data);
  res.sendStatus(200);
});`}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
