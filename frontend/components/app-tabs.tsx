"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FC } from "react";
import { cn } from "@/lib/utils";

/**
 * Top-level application tabs. Renders in the root layout above the
 * active route, so every page shares the same nav. Tabs are Next.js
 * app-router links — each maps to its own route segment so refresh
 * and the browser back button behave naturally.
 */
const TABS = [
  { href: "/", label: "對話" },
  { href: "/events", label: "活動推薦" },
  { href: "/sheng-yen", label: "聖嚴師父身影" },
] as const;

export const AppTabs: FC = () => {
  const pathname = usePathname();
  return (
    <nav
      aria-label="主要功能分頁"
      className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-4"
    >
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/"
            ? pathname === "/"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
