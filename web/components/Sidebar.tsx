"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  Smartphone, 
  CreditCard, 
  Send, 
  Inbox, 
  Key, 
  Webhook, 
  LogOut,
  Radio
} from "lucide-react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Devices", href: "/devices", icon: Smartphone },
  { name: "SIM Quotas", href: "/sims", icon: CreditCard },
  { name: "Outbound SMS", href: "/messages/outbound", icon: Send },
  { name: "Inbound Inbox", href: "/messages/inbox", icon: Inbox },
  { name: "API Keys", href: "/settings/api-keys", icon: Key },
  { name: "Webhooks", href: "/settings/webhooks", icon: Webhook },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="p-6 border-b border-border flex items-center gap-3">
        <div className="size-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
          <Radio className="size-5" />
        </div>
        <div>
          <h1 className="font-bold text-foreground leading-tight">SMS Gateway</h1>
          <p className="text-xs text-muted-foreground font-medium">Supabase Powered</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative block"
            >
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 bg-primary/10 rounded-lg"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <Icon className={`size-4 z-10 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className="z-10">{item.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Sign Out */}
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          onClick={handleSignOut}
          className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="size-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
