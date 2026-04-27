"use client";

import { Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-zinc-200 bg-white px-3 py-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(e as unknown as FormEvent);
          }
        }}
        rows={1}
        placeholder="Send a message"
        className="min-h-[40px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:bg-zinc-300"
        aria-label="Send"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
