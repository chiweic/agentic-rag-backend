"use client";

import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
} from "@assistant-ui/react";
import { UserButton } from "@clerk/nextjs";
import { ArchiveIcon, MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import type { FC } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";

export const ThreadListSidebar: FC = () => {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between border-b px-4 py-4">
        <div className="text-sm font-semibold">Threads</div>
      </div>

      <div className="p-3">
        <ThreadListPrimitive.New asChild>
          <Button className="w-full justify-start gap-2" variant="outline">
            <MessageSquarePlusIcon className="size-4" />
            New Thread
          </Button>
        </ThreadListPrimitive.New>
      </div>

      <ThreadListPrimitive.Root className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="space-y-1">
          <ThreadListPrimitive.Items>
            {() => <ThreadListItem />}
          </ThreadListPrimitive.Items>
        </div>
      </ThreadListPrimitive.Root>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <UserButton />
      </div>
    </aside>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-accent data-[current]:bg-accent">
      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">
          <ThreadListItemPrimitive.Title />
        </span>
      </ThreadListItemPrimitive.Trigger>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <ThreadListItemPrimitive.Archive asChild>
          <TooltipIconButton tooltip="Archive">
            <ArchiveIcon />
          </TooltipIconButton>
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete asChild>
          <TooltipIconButton tooltip="Delete">
            <Trash2Icon />
          </TooltipIconButton>
        </ThreadListItemPrimitive.Delete>
      </div>
    </ThreadListItemPrimitive.Root>
  );
};
