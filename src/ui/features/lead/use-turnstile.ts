"use client";

import { useCallback, useEffect, useRef } from "react";

import { loadTurnstile, turnstileRenderOptions, type TurnstileApi } from "@/ui/features/lead/turnstile";

/**
 * Renders the Turnstile widget into the returned container once it is mounted; Cloudflare adds the hidden
 * `cf-turnstile-response` field there. `reset` asks for a new token (a token is accepted only once).
 */
export function useTurnstile(siteKey: string, slug: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        const container = containerRef.current;
        if (cancelled || container === null) {
          return;
        }
        const id = api.render(container, turnstileRenderOptions(siteKey, slug));
        if (id !== undefined) {
          widget.current = { api, id };
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      widget.current?.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [siteKey, slug]);

  const reset = useCallback(() => {
    widget.current?.api.reset(widget.current.id);
  }, []);

  return { containerRef, reset };
}
