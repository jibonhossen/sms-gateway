"use client";

import * as React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, AlertTriangle, ShieldCheck, Zap } from "lucide-react";
import type { SimSubscription } from "@/types/database";

interface SimQuotaChartProps {
  sims: SimSubscription[];
}

const COLORS = [
  "#10b981", // Emerald
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
];

export function SimQuotaChart({ sims }: SimQuotaChartProps) {
  const chartData = React.useMemo(() => {
    if (sims.length === 0) {
      return [
        { name: "Slot 0: Grameenphone", balance: 3850, carrier: "Grameenphone", fill: COLORS[0], quarantined: false },
        { name: "Slot 1: Banglalink", balance: 2400, carrier: "Banglalink", fill: COLORS[1], quarantined: false },
      ];
    }
    return sims.map((s, idx) => {
      const isQuarantined = s.status === "quarantined";
      return {
        name: `Slot ${s.sim_slot}: ${s.carrier_name || s.phone_number || "SIM"}`,
        balance: Math.max(0, s.available_balance || 0),
        carrier: s.carrier_name || `Slot ${s.sim_slot}`,
        fill: isQuarantined ? "#ef4444" : COLORS[idx % COLORS.length],
        quarantined: isQuarantined,
      };
    });
  }, [sims]);

  const totalBalance = chartData.reduce((acc, s) => acc + s.balance, 0);
  const quarantinedCount = sims.filter((s) => s.status === "quarantined").length;

  return (
    <Card className="shadow-xs border-border/80 bg-card/70 backdrop-blur-sm flex flex-col justify-between h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="size-4 text-blue-500" />
            SIM Quota Pool
          </CardTitle>
          {quarantinedCount > 0 ? (
            <Badge variant="destructive" className="text-[10px] font-semibold px-2 py-0.5 rounded-full">
              <AlertTriangle className="size-3 mr-1" /> {quarantinedCount} Quarantined
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-semibold border-emerald-500/30 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <ShieldCheck className="size-3 mr-1" /> All Healthy
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          Failover balance and carrier transmission capacity
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 pb-4 flex flex-col justify-between gap-4">
        {/* Donut Chart with Centered Total */}
        <div className="relative size-[180px] mx-auto shrink-0 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0];
                    return (
                      <div className="rounded-xl border border-white/10 bg-zinc-950/90 p-2.5 shadow-xl backdrop-blur-md text-xs">
                        <p className="font-semibold text-zinc-200">{data.name}</p>
                        <p className="font-mono text-zinc-400 tabular-nums">{Number(data.value).toLocaleString()} SMS remaining</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Pie
                data={chartData}
                dataKey="balance"
                nameKey="name"
                innerRadius={54}
                outerRadius={78}
                paddingAngle={4}
                strokeWidth={3}
                stroke="#121216"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Centered Total Label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Total</span>
            <span className="text-lg font-extrabold tracking-tight font-mono text-foreground tabular-nums">
              {totalBalance.toLocaleString()}
            </span>
            <span className="text-[9px] text-muted-foreground/70">SMS left</span>
          </div>
        </div>

        {/* Carrier Breakdown List */}
        <div className="space-y-2 pt-2 border-t border-border/60">
          {chartData.map((item, idx) => {
            const percentage = totalBalance > 0 ? Math.round((item.balance / totalBalance) * 100) : 0;
            return (
              <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-2 rounded-full shrink-0 ring-2 ring-white/10" style={{ backgroundColor: item.fill }} />
                  <span className="text-muted-foreground font-medium truncate">{item.carrier}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {item.balance.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60 w-8 text-right font-mono">
                    {percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
