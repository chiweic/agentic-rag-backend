"use client";

import {
  createContext,
  type FC,
  type PropsWithChildren,
  useCallback,
  useContext,
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

  const open = useCallback((target: DeepDiveTarget) => {
    setCurrent(target);
  }, []);
  const close = useCallback(() => {
    setCurrent(null);
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
