import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useAui } from "@assistant-ui/store";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import type { FC } from "react";
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { useDeepDive } from "@/components/assistant-ui/deep-dive-provider";
import {
  DeepDiveStarters,
  useDeepDiveSource,
} from "@/components/assistant-ui/deep-dive-starters";
import {
  EventsWelcome,
  useIsEventsScope,
} from "@/components/assistant-ui/events-welcome";
import { FollowupSuggestions } from "@/components/assistant-ui/followup-suggestions";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { MediaCitationList } from "@/components/assistant-ui/media-citation-list";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { ShengYenFollowups } from "@/components/assistant-ui/sheng-yen-followups";
import {
  ShengYenWelcome,
  useIsShengYenScope,
} from "@/components/assistant-ui/sheng-yen-welcome";
import { StarterSuggestions } from "@/components/assistant-ui/starter-suggestions";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  useIsWhatsNewScope,
  WhatsNewWelcome,
} from "@/components/assistant-ui/whats-new-welcome";
import {
  CitationList,
  type SerializableCitation,
} from "@/components/tool-ui/citation";
import { Button } from "@/components/ui/button";
import type { Citation } from "@/lib/chatApi";
import { toToolUiCitations } from "@/lib/citations-adapter";
import { cn } from "@/lib/utils";

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="bottom"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  // Five empty-state flavours share one chrome:
  //   - Deep Dive overlay (pinned to one source record)
  //   - /events (events corpus, recommendation starter cards)
  //   - /sheng-yen (audio + video corpora, A/V recommendation cards)
  //   - /whats-new (news + 5 corpora, headline + dharma-action cards)
  //   - default chat (global starter prompts from the QA pool)
  const deepDiveSource = useDeepDiveSource();
  const isDeepDive = deepDiveSource !== null;
  const isEvents = useIsEventsScope();
  const isShengYen = useIsShengYenScope();
  const isWhatsNew = useIsWhatsNewScope();

  const heading = isDeepDive
    ? "探索這份來源。"
    : isEvents
      ? "找活動?"
      : isShengYen
        ? "聖嚴師父身影"
        : isWhatsNew
          ? "時事禪心"
          : "今天想問什麼？";
  const subheading = isDeepDive
    ? "可針對左側來源內容提出任何問題。"
    : isEvents
      ? "從推薦開始,或直接提問。"
      : isShengYen
        ? "選一段影音開始,或直接提問。"
        : isWhatsNew
          ? "從今日主題開始,或直接提問。"
          : "帶點禪味的 AI";

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-3xl duration-200">
            {heading}
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-lg delay-75 duration-200">
            {subheading}
          </p>
        </div>
      </div>
      {isDeepDive ? (
        <DeepDiveStarters />
      ) : isEvents ? (
        <EventsWelcome />
      ) : isShengYen ? (
        <ShengYenWelcome />
      ) : isWhatsNew ? (
        <WhatsNewWelcome />
      ) : (
        <StarterSuggestions />
      )}
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="composer-shell"
          className="flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="輸入訊息..."
            className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
            rows={1}
            autoFocus
            aria-label="訊息輸入"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="傳送訊息"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label="傳送訊息"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="停止生成"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") return <MarkdownText />;
            if (part.type === "reasoning") return <Reasoning {...part} />;
            if (part.type === "tool-call")
              return part.toolUI ?? <ToolFallback {...part} />;
            return null;
          }}
        </MessagePrimitive.Parts>
        <AssistantMessageCitations />
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessageCitations: FC = () => {
  const citations = useAuiState(
    (s) =>
      (s.message.metadata.custom as { citations?: Citation[] } | undefined)
        ?.citations,
  );
  const isLast = useAuiState((s) => s.message.isLast);
  const parentThreadId = useAuiState(
    (s) => s.threadListItem.externalId ?? s.threadListItem.remoteId ?? null,
  );
  const deepDive = useDeepDive();
  const deepDiveSource = useDeepDiveSource();
  const isDeepDive = deepDiveSource !== null;
  const isEvents = useIsEventsScope();
  const isShengYen = useIsShengYenScope();
  const isWhatsNew = useIsWhatsNewScope();

  // Deep-dive mode: backend suppresses citations to avoid Deep-Dive-in-
  // Deep-Dive loops, so the normal citation/follow-up render path is
  // inert. Instead, re-render the 4 source-aware starter prompts under
  // the latest assistant turn so the user can ratchet through common
  // exploration questions without retyping.
  if (isDeepDive) {
    return isLast ? (
      <div className="mt-4">
        <DeepDiveStarters variant="followup" />
      </div>
    ) : null;
  }

  if (!citations?.length) return null;
  const adapted = toToolUiCitations(citations);
  if (adapted.length === 0) return null;

  // 聖嚴師父身影 tab: render cited A/V chunks as playable mini-cards
  // (Audio / YouTube) instead of the text-stacked pill used
  // elsewhere, and follow-ups as a 4-col grid below.
  if (isShengYen) {
    return (
      <div className="mt-4">
        <MediaCitationList id="sheng-yen-citations" citations={adapted} />
        {isLast ? <ShengYenFollowups /> : null}
      </div>
    );
  }

  // Keyed lookup so `onNavigate` can recover the Deep-Dive identifiers
  // (recordId / sourceType) that tool-ui's SerializableCitation shape
  // doesn't carry.
  const byId = new Map(adapted.map((c) => [c.id, c]));
  const handleNavigate = (href: string, citation: SerializableCitation) => {
    const full = byId.get(citation.id);
    // /events and /whats-new intentionally bypass Deep Dive — that
    // flow was scoped out of those milestones ("deep dive is not
    // needed" for events; "stacked with links to url" for whats-new,
    // per features_v4.md §4). Neither route hosts a DeepDiveProvider
    // today so `deepDive` is null there anyway; either way we fall
    // through to opening the raw source_url in a new tab.
    const bypassDeepDive = isEvents || isWhatsNew;
    if (!bypassDeepDive && deepDive && full?.recordId && full?.sourceType) {
      deepDive.open({
        recordId: full.recordId,
        sourceType: full.sourceType,
        parentThreadId,
      });
      return;
    }
    window.open(href, "_blank", "noreferrer");
  };

  // Strip Deep Dive-only fields so the list receives a clean
  // SerializableCitation[] (tool-ui types it as such).
  const display: SerializableCitation[] = adapted.map(
    ({ recordId: _r, sourceType: _s, ...rest }) => rest,
  );

  return (
    <>
      <div className="mt-4">
        <CitationList
          id="assistant-citations"
          variant="stacked"
          citations={display}
          onNavigate={handleNavigate}
        />
      </div>
      {isLast ? <FollowupSuggestions /> : null}
    </>
  );
};

/**
 * Replays the last user message as a new turn.
 *
 * Assistant-UI's `ActionBarPrimitive.Reload` requires checkpoint-fork
 * support on the runtime (via `getCheckpointId`), which in turn needs a
 * backend `checkpoint_id` passthrough and a way to resolve it. Until
 * that lands, this custom button does a simple "ask the same question
 * again" — appends a fresh user turn with the text from the nearest
 * preceding user message. Shows a duplicate user turn in the
 * transcript instead of branching, which is the accepted tradeoff.
 *
 * Carries over the composer's runConfig so Deep Dive scope metadata
 * (`scope_record_id` etc.) survives the replay.
 */
const RefreshReplayButton: FC = () => {
  const aui = useAui();
  const messageId = useAuiState((s) => s.message.id);

  const handleClick = () => {
    const thread = aui.thread();
    const state = thread.getState();
    if (state.isRunning) return;

    const messages = state.messages;
    const currentIdx = messages.findIndex((m) => m.id === messageId);
    if (currentIdx < 0) return;

    for (let i = currentIdx - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate.role !== "user") continue;
      const text = extractUserText(candidate.content);
      if (!text) return;
      thread.append({
        content: [{ type: "text", text }],
        runConfig: aui.composer().getState().runConfig,
      });
      return;
    }
  };

  return (
    <TooltipIconButton tooltip="重新產生" onClick={handleClick}>
      <RefreshCwIcon />
    </TooltipIconButton>
  );
};

function extractUserText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      (part as { type?: unknown }).type === "text" &&
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("\n\n").trim();
}

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="複製">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <RefreshReplayButton />
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton tooltip="有幫助">
          <AuiIf
            condition={(s) =>
              s.message.metadata.submittedFeedback?.type === "positive"
            }
          >
            <ThumbsUpIcon className="fill-current" />
          </AuiIf>
          <AuiIf
            condition={(s) =>
              s.message.metadata.submittedFeedback?.type !== "positive"
            }
          >
            <ThumbsUpIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton tooltip="沒幫助">
          <AuiIf
            condition={(s) =>
              s.message.metadata.submittedFeedback?.type === "negative"
            }
          >
            <ThumbsDownIcon className="fill-current" />
          </AuiIf>
          <AuiIf
            condition={(s) =>
              s.message.metadata.submittedFeedback?.type !== "negative"
            }
          >
            <ThumbsDownIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="更多"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              匯出為 Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="編輯" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              取消
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">更新</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="上一則">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="下一則">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
