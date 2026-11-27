"use client";

import { useEffect } from "react";
import { confirm } from "@/components/ui/feedback";

/** Forms on screen that have edits not saved yet. */
const dirtyForms = new Set<symbol>();

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = ""; // older Chrome/Safari need this to show the prompt
};

/**
 * Mark this form as having unsaved edits while `dirty` is true: closing or reloading the tab asks first,
 * and in-app navigation can ask with `confirmDiscard()`.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const id = Symbol("form");
    dirtyForms.add(id);
    if (dirtyForms.size === 1) window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      dirtyForms.delete(id);
      if (dirtyForms.size === 0) window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);
}

export const hasUnsavedChanges = () => dirtyForms.size > 0;

/** Before leaving a screen inside the app: true right away if nothing is unsaved, otherwise asks. */
export async function confirmDiscard(): Promise<boolean> {
  if (dirtyForms.size === 0) return true;
  return confirm({
    title: "Discard unsaved changes?",
    description: "You changed some settings without saving them. Leaving now throws those changes away.",
    confirmLabel: "Discard changes",
    destructive: true,
  });
}
