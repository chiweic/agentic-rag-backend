"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal subset of the Web Speech API surface we use. The browser
// types (lib.dom) ship `SpeechRecognition` only behind a vendor-prefix
// declaration, so we keep our own thin shape.
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechErrorReason =
  | "not-supported"
  | "permission-denied"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "other";

export interface UseSpeechRecognitionOptions {
  lang?: string; // default zh-TW per features_v5.md §1
  interim?: boolean;
  // Called every time a partial or final transcript arrives.
  // `transcript` is the cumulative text for the current session
  // (interim while speaking, then final when the engine settles).
  onResult: (transcript: string, isFinal: boolean) => void;
}

export interface UseSpeechRecognitionReturn {
  supported: boolean;
  listening: boolean;
  error: SpeechErrorReason | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions,
): UseSpeechRecognitionReturn {
  const { lang = "zh-TW", interim = true, onResult } = options;

  const [supported, setSupported] = useState<boolean>(false);
  const [listening, setListening] = useState<boolean>(false);
  const [error, setError] = useState<SpeechErrorReason | null>(null);

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Feature-detect once on mount. Stays false on Firefox / non-browser
  // environments → consumer hides the mic button.
  useEffect(() => {
    setSupported(getCtor() !== null);
  }, []);

  const ensureInstance = useCallback((): SpeechRecognitionInstance | null => {
    if (recRef.current) return recRef.current;
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = interim;
    rec.continuous = false;
    rec.onresult = (event) => {
      // Concatenate every result this session — the engine sends
      // results indexed from `resultIndex`, but we want the running
      // total for the composer.
      let acc = "";
      let isFinal = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (!r) continue;
        acc += r[0].transcript;
        if (r.isFinal) isFinal = true;
      }
      onResultRef.current(acc, isFinal);
    };
    rec.onerror = (event) => {
      const reason = mapError(event.error);
      setError(reason);
    };
    rec.onend = () => {
      setListening(false);
    };
    recRef.current = rec;
    return rec;
  }, [lang, interim]);

  const start = useCallback(() => {
    setError(null);
    const rec = ensureInstance();
    if (!rec) {
      setError("not-supported");
      return;
    }
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if already running — treat as a no-op rather
      // than surfacing a confusing error.
    }
  }, [ensureInstance]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore — onend handler resets `listening`
    }
  }, []);

  // Tear down on unmount so a navigating-away user doesn't leave the
  // mic stream open.
  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { supported, listening, error, start, stop };
}

function mapError(raw: string): SpeechErrorReason {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "audio-capture";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    default:
      return "other";
  }
}
