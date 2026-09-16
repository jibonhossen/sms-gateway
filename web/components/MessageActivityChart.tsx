"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OutboundMessage } from "@/types/database";

export type TimeRange = "1h" | "24h" | "7d" | "30d";

interface MessageActivityChartProps {
  messages: OutboundMessage[];
  onRefresh?: () => void;
  isLoading?: boolean;
}

interface BucketData {
  id: number;
  startTime: Date;
  endTime: Date;
  startTimeStr: string;
  total: number;
  delivered: number;
  sent: number;
  pending: number;
  failed: number;
  heightPercent: number;
}

export function MessageActivityChart({
  messages,
}: MessageActivityChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [hoveredBar, setHoveredBar] = useState<BucketData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Compute time bounds based on selected time range
  const { startTime, endTime, numBuckets, bucketDurationMs } = useMemo(() => {
    const end = new Date();
    let durationMs = 24 * 60 * 60 * 1000; // default 24h
    let buckets = 48; // 30-min intervals

    if (timeRange === "1h") {
      durationMs = 60 * 60 * 1000;
      buckets = 54; // ~1.1 min intervals
    } else if (timeRange === "24h") {
      durationMs = 24 * 60 * 60 * 1000;
      buckets = 48; // 30-min intervals
    } else if (timeRange === "7d") {
      durationMs = 7 * 24 * 60 * 60 * 1000;
      buckets = 42; // 4-hour intervals
    } else if (timeRange === "30d") {
      durationMs = 30 * 24 * 60 * 60 * 1000;
      buckets = 45; // 16-hour intervals
    }

    const start = new Date(end.getTime() - durationMs);
    return {
      startTime: start,
      endTime: end,
      numBuckets: buckets,
      bucketDurationMs: durationMs / buckets,
    };
  }, [timeRange]);

  // Format timestamps
  const formatTimeLabel = (d: Date, range: TimeRange) => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[d.getMonth()];
    const day = d.getDate();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;

    if (range === "1h" || range === "24h") {
      return `${month} ${day}, ${hours}:${minutes}${ampm}`;
    }
    return `${month} ${day}, ${hours}${ampm}`;
  };

  // Filter messages strictly within the selected time window
  const windowMessages = useMemo(() => {
    return messages.filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= startTime.getTime() && t <= endTime.getTime();
    });
  }, [messages, startTime, endTime]);

  // Aggregate real message data into discrete time buckets
  const { buckets, totalCount, warningCount, errorCount, deliveredCount, maxBucketVolume } = useMemo(() => {
    let warnings = 0;
    let errors = 0;
    let delivered = 0;
    let maxCount = 0;

    const rawBuckets: Omit<BucketData, "heightPercent">[] = [];

    for (let i = 0; i < numBuckets; i++) {
      const bStart = new Date(startTime.getTime() + i * bucketDurationMs);
      const bEnd = new Date(bStart.getTime() + bucketDurationMs);

      const inSlice = windowMessages.filter((m) => {
        const t = new Date(m.created_at).getTime();
        return t >= bStart.getTime() && t < bEnd.getTime();
      });

      const dCount = inSlice.filter((m) => m.status === "delivered").length;
      const sCount = inSlice.filter((m) => m.status === "sent").length;
      const pCount = inSlice.filter((m) => m.status === "pending" || m.status === "processing" || (m.retry_count && m.retry_count > 0 && m.status !== "failed")).length;
      const fCount = inSlice.filter((m) => m.status === "failed").length;

      delivered += dCount + sCount;
      warnings += pCount;
      errors += fCount;

      const totalSlice = inSlice.length;
      if (totalSlice > maxCount) maxCount = totalSlice;

      rawBuckets.push({
        id: i,
        startTime: bStart,
        endTime: bEnd,
        startTimeStr: formatTimeLabel(bStart, timeRange),
        total: totalSlice,
        delivered: dCount,
        sent: sCount,
        pending: pCount,
        failed: fCount,
      });
    }

    // Scale bucket heights strictly to real data volume
    const scaledBuckets: BucketData[] = rawBuckets.map((b) => {
      if (b.total === 0) {
        return { ...b, heightPercent: 3 }; // 3% subtle baseline
      }
      // Proportional scale between 20% and 100%
      const scaled = maxCount <= 1 ? 75 : Math.min(100, Math.max(20, Math.round((b.total / maxCount) * 100)));
      return { ...b, heightPercent: scaled };
    });

    return {
      buckets: scaledBuckets,
      totalCount: windowMessages.length,
      warningCount: warnings,
      errorCount: errors,
      deliveredCount: delivered,
      maxBucketVolume: maxCount,
    };
  }, [windowMessages, startTime, bucketDurationMs, numBuckets, timeRange]);

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>, bar: BucketData) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHoveredBar(bar);
    setTooltipPos({ x, y });
  };

  const handleMouseLeave = () => {
    setHoveredBar(null);
    setTooltipPos(null);
  };

  return (
    <Card className="border-border/80 bg-card/85 backdrop-blur-md rounded-2xl shadow-xs overflow-hidden flex flex-col justify-between h-full">
      <CardContent className="p-6 pb-5 flex flex-col justify-between h-full">
        {/* Top Header Row - Real Data Telemetry & Time Range Controls */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-semibold tracking-wider text-muted-foreground uppercase">
                SMS GATEWAY THROUGHPUT
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Live Data
              </span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-foreground mt-0.5 tabular-nums">
              {totalCount.toLocaleString()}
              <span className="text-xs font-normal text-muted-foreground font-sans ml-2">
                messages in window
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5 sm:gap-7">
            {/* Warnings Metric */}
            <div className="flex flex-col items-center min-w-[65px]">
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold tracking-wider text-muted-foreground uppercase">
                <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                <span>WARNINGS</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-foreground mt-0.5 tabular-nums">
                {warningCount}
              </div>
            </div>

            {/* Errors Metric */}
            <div className="flex flex-col items-center min-w-[55px]">
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold tracking-wider text-muted-foreground uppercase">
                <span className="size-2 rounded-full bg-rose-400 shrink-0" />
                <span>ERRORS</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-foreground mt-0.5 tabular-nums">
                {errorCount}
              </div>
            </div>

            {/* Time Range Selector */}
            <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-border/60">
              {(["1h", "24h", "7d", "30d"] as TimeRange[]).map((r) => (
                <Button
                  key={r}
                  variant={timeRange === r ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setTimeRange(r)}
                  className="h-7 text-xs px-2 sm:px-2.5 rounded-lg font-mono font-semibold cursor-pointer"
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Dense Vertical Bar Histogram Chart */}
        <div ref={containerRef} className="relative w-full h-36 select-none my-auto">
          <svg
            className="w-full h-full overflow-visible"
            viewBox="0 0 540 120"
            preserveAspectRatio="none"
          >
            {buckets.map((bar, idx) => {
              const barWidth = 6.8;
              const gap = 3.2;
              const x = idx * (barWidth + gap);
              const maxHeight = 110;
              const barHeight = Math.max(3, (bar.heightPercent / 100) * maxHeight);
              const y = maxHeight - barHeight + 5;
              const isHovered = hoveredBar?.id === bar.id;

              // Color strictly reflects real bucket status
              let fillColor = "#27272a"; // Zinc-800 for empty baseline
              let opacity = 0.35;

              if (bar.total > 0) {
                opacity = isHovered ? 1 : 0.9;
                if (bar.failed > 0) {
                  fillColor = isHovered ? "#fb7185" : "#f43f5e"; // Rose
                } else if (bar.pending > 0) {
                  fillColor = isHovered ? "#fbbf24" : "#f59e0b"; // Amber
                } else {
                  fillColor = isHovered ? "#34d399" : "#10b981"; // Emerald
                }
              } else if (isHovered) {
                opacity = 0.7;
                fillColor = "#3f3f46";
              }

              return (
                <rect
                  key={bar.id}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={1.5}
                  className="transition-all duration-150 cursor-pointer"
                  fill={fillColor}
                  opacity={opacity}
                  onMouseMove={(e) => handleMouseMove(e, bar)}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })}
          </svg>

          {/* Floating Tooltip */}
          {hoveredBar && tooltipPos && (
            <div
              className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-full mb-2 bg-zinc-950/95 text-zinc-100 border border-border/80 shadow-2xl rounded-xl p-3 text-xs backdrop-blur-md whitespace-nowrap"
              style={{
                left: Math.min(Math.max(tooltipPos.x, 90), (containerRef.current?.offsetWidth || 300) - 90),
                top: Math.max(10, tooltipPos.y - 12),
              }}
            >
              <div className="font-mono text-[11px] text-muted-foreground pb-1.5 border-b border-border/40">
                {hoveredBar.startTimeStr}
              </div>
              <div className="flex items-center justify-between gap-4 pt-1.5">
                <span className="text-zinc-400 font-sans">Total Volume:</span>
                <span className="font-mono font-bold text-foreground">{hoveredBar.total} msg(s)</span>
              </div>
              {hoveredBar.total > 0 ? (
                <>
                  <div className="flex items-center justify-between gap-4 text-emerald-400 font-mono text-[11px] pt-0.5">
                    <span>Delivered:</span>
                    <span>{hoveredBar.delivered + hoveredBar.sent}</span>
                  </div>
                  {hoveredBar.pending > 0 && (
                    <div className="flex items-center justify-between gap-4 text-amber-400 font-mono text-[11px] pt-0.5">
                      <span>In Queue / Retries:</span>
                      <span>{hoveredBar.pending}</span>
                    </div>
                  )}
                  {hoveredBar.failed > 0 && (
                    <div className="flex items-center justify-between gap-4 text-rose-400 font-mono text-[11px] pt-0.5">
                      <span>Carrier Errors:</span>
                      <span>{hoveredBar.failed}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-zinc-500 text-[11px] pt-0.5 italic">
                  No activity in this time slot
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Timestamp Legend */}
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground pt-3 border-t border-border/40">
          <span>{formatTimeLabel(startTime, timeRange)}</span>
          <span>{formatTimeLabel(endTime, timeRange)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
