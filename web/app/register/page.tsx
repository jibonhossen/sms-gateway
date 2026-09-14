"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Radio, Lock, Mail, User, AlertCircle, Loader2, CheckCircle, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 size-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md relative z-10"
      >
        <Card className="shadow-2xl border-border/80 bg-card/85 backdrop-blur-xl rounded-2xl overflow-hidden">
          <CardHeader className="text-center pb-6 pt-8">
            <div className="mx-auto size-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white mb-4 shadow-lg shadow-blue-500/25 ring-1 ring-white/20">
              <Radio className="size-6" />
            </div>
            <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">
              Create Organization
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Start managing cellular SMS gateway infrastructure in seconds
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            {error && (
              <Alert variant="destructive" className="mb-4 rounded-xl border-rose-500/30 bg-rose-500/10 text-rose-400">
                <AlertCircle className="size-4 text-rose-500" />
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="mb-4 rounded-xl border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <CheckCircle className="size-4 text-emerald-500" />
                <AlertDescription className="text-xs">Organization provisioned! Launching mission control...</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-semibold text-foreground">Organization / Company</Label>
                <div className="relative">
                  <User className="size-4 text-muted-foreground absolute left-3.5 top-3" />
                  <Input
                    id="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme Telecom"
                    className="pl-10 text-sm bg-muted/40 rounded-xl border-border/80 h-10"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-foreground">Email address</Label>
                <div className="relative">
                  <Mail className="size-4 text-muted-foreground absolute left-3.5 top-3" />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@acme.com"
                    className="pl-10 text-sm bg-muted/40 rounded-xl border-border/80 h-10"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">Password</Label>
                <div className="relative">
                  <Lock className="size-4 text-muted-foreground absolute left-3.5 top-3" />
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="pl-10 text-sm bg-muted/40 rounded-xl border-border/80 h-10"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || success}
                className="w-full mt-2 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground h-10 shadow-md shadow-primary/20 text-sm"
              >
                {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Organization Account
                {!loading && <ArrowRight className="size-4 ml-2" />}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center border-t border-border/60 py-4 text-xs text-muted-foreground bg-muted/20">
            Already registered?{" "}
            <Link href="/login" className="text-primary font-semibold hover:underline ml-1">
              Sign In
            </Link>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
