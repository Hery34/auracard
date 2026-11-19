"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The browser's IANA zone; null while rendered on the server (the static HTML never depends on it). */
export function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(subscribe, browserTimeZone, () => null);
}
