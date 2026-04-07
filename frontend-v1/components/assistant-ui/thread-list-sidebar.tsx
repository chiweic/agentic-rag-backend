"use client";

import { useClerk } from "@clerk/nextjs";
import {
  CheckIcon,
  ChevronUpIcon,
  GraduationCapIcon,
  LogInIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { type FC, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth-store";
import {
  deleteBackendThread,
  renameBackendThread,
} from "@/lib/backend-threads";
import { useChatStore } from "@/lib/chat-store";
import { isClerkEnabled } from "@/lib/clerk";

const ClerkLogoutButton = ({
  compact = false,
  onBeforeLogout,
}: {
  compact?: boolean;
  onBeforeLogout?: () => void;
}) => {
  const { signOut } = useClerk();
  const localSignOut = useAuthStore((state) => state.signOut);

  return (
    <Button
      type="button"
      size={compact ? "icon-xs" : "sm"}
      variant="ghost"
      className={compact ? "shrink-0" : "w-full justify-start gap-2 rounded-lg"}
      aria-label="Logout"
      data-testid="auth-logout-action"
      onClick={() => {
        onBeforeLogout?.();
        localSignOut();
        void signOut({ redirectUrl: "/" });
      }}
    >
      <LogOutIcon className="size-4" />
      {compact ? null : "Logout"}
    </Button>
  );
};

const getThreadLabel = (
  thread: ReturnType<typeof useChatStore.getState>["threads"][string],
) => {
  if (thread.title) return thread.title;
  if (thread.messages.length > 0) {
    const firstMessage = thread.messages.find(
      (message) => message.role === "user",
    );
    if (firstMessage) {
      const content =
        typeof firstMessage.content === "string"
          ? firstMessage.content
          : firstMessage.content
              .filter(
                (
                  part,
                ): part is Extract<
                  (typeof firstMessage.content)[number],
                  { type: "text" }
                > => part.type === "text",
              )
              .map((part) => part.text)
              .join(" ");

      if (content.trim()) {
        return content.slice(0, 36);
      }
    }
  }

  return thread.id;
};

export const ThreadListSidebar: FC = () => {
  const authToken = useAuthStore((state) => state.token);
  const profile = useAuthStore((state) => state.profile);
  const authMessage = useAuthStore((state) => state.authMessage);
  const signOut = useAuthStore((state) => state.signOut);
  const clearAuthMessage = useAuthStore((state) => state.clearAuthMessage);
  const threadOrder = useChatStore((state) => state.threadOrder);
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const createThread = useChatStore((state) => state.createThread);
  const switchThread = useChatStore((state) => state.switchThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const deleteThread = useChatStore((state) => state.deleteThread);
  const restoreThread = useChatStore((state) => state.restoreThread);
  const setThreadSyncStatus = useChatStore(
    (state) => state.setThreadSyncStatus,
  );
  const markThreadSynced = useChatStore((state) => state.markThreadSynced);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    if (accountMenuOpen) {
      document.addEventListener("mousedown", onPointerDown);
    }

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [accountMenuOpen]);

  const startRename = (threadId: string) => {
    setEditingThreadId(threadId);
    setDraftTitle(threads[threadId]?.title ?? "");
  };

  const commitRename = () => {
    if (!editingThreadId) return;
    const threadId = editingThreadId;
    const nextTitle = draftTitle.trim() || null;
    const thread = threads[threadId];
    const backendThreadId = thread?.backendThreadId ?? null;
    renameThread(threadId, nextTitle);
    if (backendThreadId) {
      setThreadSyncStatus(threadId, "syncing");
      void (async () => {
        try {
          await renameBackendThread(backendThreadId, nextTitle);
          markThreadSynced(threadId);
        } catch (error) {
          setThreadSyncStatus(threadId, "error");
          console.warn("Failed to rename backend thread", error);
        }
      })();
    }
    setEditingThreadId(null);
    setDraftTitle("");
  };

  const cancelRename = () => {
    setEditingThreadId(null);
    setDraftTitle("");
  };

  const handleDelete = (threadId: string) => {
    const thread = threads[threadId];
    const backendThreadId = thread?.backendThreadId ?? null;
    const threadIndex = threadOrder.indexOf(threadId);
    deleteThread(threadId);
    if (backendThreadId && thread) {
      void deleteBackendThread(backendThreadId).catch((error) => {
        restoreThread(
          {
            ...thread,
            syncStatus: "error",
          },
          Math.max(threadIndex, 0),
        );
        console.warn("Failed to delete backend thread", error);
      });
    }
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-muted/20">
      <div className="border-b px-4 py-4">
        <div className="text-sm font-semibold">Threads</div>
        <div className="text-xs text-muted-foreground">
          App-owned state via Zustand
        </div>
      </div>

      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          variant="outline"
          onClick={() => createThread()}
          data-testid="thread-create-button"
        >
          <MessageSquarePlusIcon className="size-4" />
          New Thread
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="space-y-1">
          {threadOrder.map((threadId) => {
            const thread = threads[threadId];
            if (!thread) return null;

            return (
              <div
                key={thread.id}
                data-testid="thread-item"
                data-active={thread.id === activeThreadId ? "true" : "false"}
                className={
                  "rounded-lg px-3 py-2 transition-colors hover:bg-accent " +
                  (thread.id === activeThreadId ? "bg-accent" : "")
                }
              >
                {editingThreadId === thread.id ? (
                  <div className="space-y-2">
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none"
                      placeholder="Thread name"
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={cancelRename}
                        aria-label="Cancel rename"
                      >
                        <XIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={commitRename}
                        aria-label="Save rename"
                      >
                        <CheckIcon />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => switchThread(thread.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-current={
                        thread.id === activeThreadId ? "page" : undefined
                      }
                    >
                      <span className="block truncate text-sm font-medium">
                        {getThreadLabel(thread)}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{thread.messages.length} messages</span>
                        {thread.historyLoadStatus === "loading" ? (
                          <span data-testid="thread-history-status">
                            Loading history
                          </span>
                        ) : null}
                        {thread.historyLoadStatus === "error" ? (
                          <span data-testid="thread-history-status">
                            History error
                          </span>
                        ) : null}
                        {thread.syncStatus === "syncing" ? (
                          <span data-testid="thread-sync-status">Syncing</span>
                        ) : null}
                        {thread.syncStatus === "error" ? (
                          <span data-testid="thread-sync-status">
                            Sync error
                          </span>
                        ) : null}
                        {thread.syncStatus === "linked" ? (
                          <span data-testid="thread-sync-status">Linked</span>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => startRename(thread.id)}
                        aria-label={`Rename ${getThreadLabel(thread)}`}
                        data-testid="thread-rename-action"
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => handleDelete(thread.id)}
                        aria-label={`Delete ${getThreadLabel(thread)}`}
                        data-testid="thread-delete-action"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t px-3 py-3">
        <div ref={accountMenuRef} className="relative">
          <button
            type="button"
            data-testid="account-menu-trigger"
            className="flex w-full items-center gap-2 rounded-xl border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            {authToken && profile ? (
              <>
                <Avatar size="sm">
                  {profile.picture ? (
                    <AvatarImage
                      src={profile.picture}
                      alt={profile.name ?? profile.email ?? "User"}
                    />
                  ) : null}
                  <AvatarFallback>
                    {(profile.name ?? profile.email ?? "U")
                      .slice(0, 1)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-tight">
                    {profile.email ?? profile.userId}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex size-7 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                  <UserIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-tight">
                    Anonymous
                  </div>
                </div>
              </>
            )}
            <ChevronUpIcon
              className={`size-4 text-muted-foreground transition-transform ${
                accountMenuOpen ? "" : "rotate-180"
              }`}
            />
          </button>

          {accountMenuOpen ? (
            <div
              data-testid="account-menu-content"
              className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-xl border bg-background p-1 shadow-lg"
            >
              {authToken && profile ? (
                <>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start gap-2 rounded-lg"
                  >
                    <Link
                      href="/assisted-learning"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      <GraduationCapIcon className="size-4" />
                      Assisted Learning
                    </Link>
                  </Button>
                  {isClerkEnabled ? (
                    <ClerkLogoutButton
                      onBeforeLogout={() => setAccountMenuOpen(false)}
                    />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start gap-2 rounded-lg"
                      data-testid="auth-logout-action"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        signOut();
                      }}
                    >
                      <LogOutIcon className="size-4" />
                      Logout
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start gap-2 rounded-lg"
                  >
                    <Link
                      href="/login"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      <LogInIcon className="size-4" />
                      Login
                    </Link>
                  </Button>
                  {isClerkEnabled ? (
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start gap-2 rounded-lg"
                    >
                      <Link
                        href="/register"
                        onClick={() => setAccountMenuOpen(false)}
                      >
                        <UserIcon className="size-4" />
                        Register
                      </Link>
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
        {authMessage ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div>{authMessage}</div>
            <button
              type="button"
              className="mt-2 underline"
              onClick={clearAuthMessage}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
