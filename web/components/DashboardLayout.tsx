"use client";

import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto w-full"
      >
        {children}
      </motion.main>
    </div>
  );
}
