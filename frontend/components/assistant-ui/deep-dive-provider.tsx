"use client";

import {
  createContext,
  type FC,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { DeepDiveOverlay } from "@/components/assistant-ui/deep-dive-overlay";

export type DeepDiveTarget = {
  recordId: string;
  sourceType: string;
  parentThreadId: string | null;
};

type DeepDiveContextValue = {
  open: (target: DeepDiveTarget) => void;
  close: () => void;
  current: DeepDiveTarget | null;
};

const DeepDiveContext = createContext<DeepDiveContextValue | null>(null);

/**
 * Global state + portal host for the Deep Dive overlay.
 *
 * Deep-dive overlays live at the root of the document via a React
 * portal so they can cover the main chat without being inside it. The
 * provider also guarantees a single-active-overlay policy — opening a
 * new target while one is visible replaces it (keeps lifecycle simple;
 * parallel deep-dive tabs are a later-stage concern).
 */
export const DeepDiveProvider: FC<PropsWithChildren> = ({ children }) => {
  const [current, setCurrent] = useState<DeepDiveTarget | null>(null);

  // History is managed here (imperatively in open/close) rather than in
  // the overlay's useEffect, because StrictMode double-invokes effects:
  // a cleanup that calls `history.back()` queues a popstate that the
  // remounted listener then catches as "user pressed Back", which
  // flicker-closes the overlay the moment it opens.
  const open = useCallback((target: DeepDiveTarget) => {
    if (typeof window !== "undefined") {
      window.history.pushState({ deepDive: true }, "");
    }
    setCurrent(target);
  }, []);

  const close = useCallback(() => {
    // Route close through the browser's back stack so the ✕ button, Esc
    // key, and the browser's Back button all converge on one code path
    // (popstate → setCurrent(null)). Without this, clicking ✕ would leave
    // an orphan history entry that pressing Back later would walk into.
    if (typeof window !== "undefined" && window.history.state?.deepDive) {
      window.history.back();
    } else {
      setCurrent(null);
    }
  }, []);

  // Global popstate listener — also triggered by our own history.back()
  // call in close(). Closing via setCurrent(null) here is idempotent.
  useEffect(() => {
    const onPop = () => setCurrent(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const value = useMemo(
    () => ({ open, close, current }),
    [open, close, current],
  );

  return (
    <DeepDiveContext.Provider value={value}>
      {children}
      {current &&
        typeof window !== "undefined" &&
        createPortal(
          <DeepDiveOverlay
            key={`${current.sourceType}/${current.recordId}`}
            target={current}
            onClose={close}
          />,
          document.body,
        )}
    </DeepDiveContext.Provider>
  );
};

export const useDeepDive = (): DeepDiveContextValue => {
  const ctx = useContext(DeepDiveContext);
  if (!ctx) {
    throw new Error("useDeepDive must be used inside a DeepDiveProvider");
  }
  return ctx;
};
