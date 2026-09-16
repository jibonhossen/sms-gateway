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
  Radio,
  Zap,
  Building2,
  ChevronRight
} from "lucide-react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { isDeviceOnline } from "@/lib/utils";

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard, badge: null },
  { name: "Devices", href: "/devices", icon: Smartphone, badge: "1" },
  { name: "SIM Quotas", href: "/sims", icon: CreditCard, badge: "2" },
  { name: "Outbound SMS", href: "/messages/outbound", icon: Send, badge: null },
  { name: "Inbound Inbox", href: "/messages/inbox", icon: Inbox, badge: null },
  { name: "API Keys", href: "/settings/api-keys", icon: Key, badge: null },
  { name: "Webhooks", href: "/settings/webhooks", icon: Webhook, badge: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>("admin@smshq.io");
  const [orgName, setOrgName] = useState<string>("SMS HQ Corp");
  const [deviceStatus, setDeviceStatus] = useState<"online" | "offline" | "none">("none");

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);
      const { data: orgs } = await supabase.from("organizations").select("name").limit(1);
      if (orgs && orgs.length > 0) setOrgName(orgs[0].name);

      const { data: devs } = await supabase.from("gateway_devices").select("status, last_heartbeat_at");
      if (devs && devs.length > 0) {
        const hasOnline = devs.some((d) => isDeviceOnline(d));
        setDeviceStatus(hasOnline ? "online" : "offline");
      } else {
        setDeviceStatus("none");
      }
    };
    loadUser();

    const channel = supabase
      .channel("sidebar_devices_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "gateway_devices" }, () => {
        loadUser();
      })
      .subscribe();

    const interval = setInterval(loadUser, 10000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <aside className="w-68 bg-sidebar border-r border-sidebar-border flex flex-col h-screen sticky top-0 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-sidebar-border/80">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 ring-1 ring-white/20">
            <Radio className="size-5 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-sm tracking-tight text-foreground truncate">SMS Gateway</h1>
              <span className="size-2 rounded-full bg-emerald-500 shrink-0 ring-2 ring-emerald-500/20" />
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium truncate">
              <Building2 className="size-3 shrink-0 text-muted-foreground/70" />
              <span className="truncate">{orgName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
          Operations
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative block group"
            >
              <div
                className={`relative flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? "text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavBackground"
                    className="absolute inset-0 bg-primary rounded-xl shadow-xs shadow-primary/30"
                    transition={{ type: "spring", stiffness: 450, damping: 35 }}
                  />
                )}
                <div className="flex items-center gap-3 relative z-10 min-w-0">
                  <Icon className={`size-4 shrink-0 transition-colors ${
                    isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                  }`} />
                  <span className="truncate tracking-tight">{item.name}</span>
                </div>
                {item.badge && (
                  <span
                    className={`relative z-10 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                      isActive 
                        ? "bg-white/20 text-white" 
                        : "bg-muted text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer / User Profile & Sign Out */}
      <div className="p-3 border-t border-sidebar-border/80 space-y-2 bg-sidebar/50">
        <div className="p-2.5 rounded-xl bg-sidebar-accent/50 border border-sidebar-border/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
              {userEmail.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{userEmail}</p>
              {deviceStatus === "online" && (
                <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Hardware Online
                </p>
              )}
              {deviceStatus === "offline" && (
                <p className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-zinc-500" />
                  Hardware Offline
                </p>
              )}
              {deviceStatus === "none" && (
                <p className="text-[10px] text-amber-500/80 font-medium flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  No Device Paired
                </p>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="w-full justify-start text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors h-8"
        >
          <LogOut className="size-3.5 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
