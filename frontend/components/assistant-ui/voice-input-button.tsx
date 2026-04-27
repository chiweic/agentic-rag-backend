"use client";

import { useComposerRuntime } from "@assistant-ui/react";
import { MicIcon, MicOffIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useRef } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import { markVoiceInput } from "@/lib/voiceInput";

// Voice dictation toggle button. Web Speech API only (on-device,
// text-only, no audio leaves the browser). features_v5.md §1.
//
// Behavior:
// - Click to start: native mic-permission prompt on first use; while
//   listening, interim transcripts overwrite the in-progress text and
//   final transcripts commit. The button shows a "stop" icon.
// - Click to stop: ends the session, leaves whatever text is in the
//   composer for the user to edit + send.
// - Permission denied / engine error: button enters a muted state with
//   a status tooltip. Click to retry.
// - Hidden (returns null) when the browser doesn't support Web Speech
//   (e.g., Firefox).
export const VoiceInputButton: FC = () => {
  const composer = useComposerRuntime();

  // Snapshot the composer text the moment we start a dictation session.
  // Voice transcript is appended to whatever the user already typed,
  // not replacing it — friendlier when someone starts a sentence by
  // hand and finishes by voice.
  const baselineRef = useRef<string>("");
  // Whether *anything* was committed during this session — only mark
  // the message as voice-originated if the dictation produced text.
  const dictatedSomethingRef = useRef<boolean>(false);

  const handleResult = useCallback(
    (transcript: string, isFinal: boolean) => {
      const next = baselineRef.current
        ? `${baselineRef.current}${transcript}`.trim()
        : transcript;
      composer.setText(next);
      if (transcript.trim().length > 0) {
        dictatedSomethingRef.current = true;
      }
      if (isFinal && dictatedSomethingRef.current) {
        // Re-mark on every final segment so the flag is set even if
        // the user clicks Send before the engine emits `onend`.
        markVoiceInput();
      }
    },
    [composer],
  );

  const { supported, listening, error, start, stop } = useSpeechRecognition({
    lang: "zh-TW",
    interim: true,
    onResult: handleResult,
  });

  // When listening flips off (engine settled or user stopped), commit
  // the voice flag if we got anything. Belt-and-suspenders alongside
  // the `isFinal` path above.
  useEffect(() => {
    if (!listening && dictatedSomethingRef.current) {
      markVoiceInput();
    }
  }, [listening]);

  if (!supported) return null;

  const onClick = () => {
    if (listening) {
      stop();
      return;
    }
    baselineRef.current = composer.getState().text ?? "";
    dictatedSomethingRef.current = false;
    start();
  };

  const tooltip = listening
    ? "停止語音輸入"
    : error === "permission-denied"
      ? "麥克風權限被封鎖 — 請在瀏覽器設定開啟"
      : error === "audio-capture"
        ? "找不到麥克風"
        : error
          ? "語音輸入暫時無法使用，再點一次重試"
          : "語音輸入";

  const Icon = error === "permission-denied" ? MicOffIcon : MicIcon;

  return (
    <TooltipIconButton
      tooltip={tooltip}
      side="bottom"
      type="button"
      variant="ghost"
      size="icon"
      className="aui-composer-mic size-8 rounded-full"
      aria-label={tooltip}
      aria-pressed={listening}
      data-listening={listening || undefined}
      data-error={error ?? undefined}
      onClick={onClick}
    >
      <Icon
        className={`size-4 ${listening ? "text-red-500" : ""} ${error === "permission-denied" ? "opacity-50" : ""}`}
      />
    </TooltipIconButton>
  );
};
