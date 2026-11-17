"use client";

import { useSyncExternalStore } from "react";

import { isInAppBrowser } from "@/ui/features/profile/in-app-browser";

const subscribe = () => () => {};
const detect = () => isInAppBrowser(navigator.userAgent);
const onServer = () => false;

/** Detected in the browser only: the static page is the same for every visitor. */
export function InAppBrowserNotice() {
  const inApp = useSyncExternalStore(subscribe, detect, onServer);
  if (!inApp) {
    return null;
  }
  return (
    <p role="note" className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
      Pour ajouter ce contact, ouvrez cette page dans votre navigateur (menu ⋯ puis « Ouvrir dans le navigateur »).
    </p>
  );
}
