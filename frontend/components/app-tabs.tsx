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
  { href: "/sheng-yen", label: "聖嚴聲影" },
  { href: "/whats-new", label: "時事禪心" },
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
            // Clicking the active tab reloads the page — cheap
            // "start a new thread" gesture on the ephemeral tabs
            // (/events, /sheng-yen, /whats-new) without shipping a
            // full ThreadList UX. Next.js Link would otherwise
            // no-op on same-route clicks.
            onClick={(e) => {
              if (isActive) {
                e.preventDefault();
                window.location.reload();
              }
            }}
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
