"use client";

import { LogOut, Plus, X } from "lucide-react";
import type { Thread } from "@/lib/api";

export function ThreadDrawer({
  open,
  onClose,
  threads,
  currentId,
  onSelect,
  onNew,
  userName,
}: {
  open: boolean;
  onClose: () => void;
  threads: Thread[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  userName: string;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[80%] max-w-[320px] flex-col bg-white shadow-xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <span className="text-sm font-medium text-zinc-900">Threads</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <button
          type="button"
          onClick={() => {
            onNew();
            onClose();
          }}
          className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50"
        >
          <Plus className="h-4 w-4" />
          New thread
        </button>

        <div className="mt-2 flex-1 overflow-y-auto px-2">
          {threads.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400">
              No threads yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {threads.map((t) => (
                <li key={t.thread_id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(t.thread_id);
                      onClose();
                    }}
                    className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm ${
                      t.thread_id === currentId
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    {t.title?.trim() || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm">
          <span className="truncate text-zinc-700">{userName}</span>
          <a
            href="/api/auth/sign-out"
            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-900"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </a>
        </footer>
      </aside>
    </>
  );
}
