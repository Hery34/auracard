import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";

/** Explicit rendering: the widget is drawn only into the open form (decision 1). */
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileOptions = { sitekey: string; theme: "auto"; language: "fr"; action: typeof LEAD_CHALLENGE_ACTION; cData: string };

/** `action` and `cData` are echoed by siteverify and compared by the server: the token is bound to this profile. */
export function turnstileRenderOptions(siteKey: string, slug: string): TurnstileOptions {
  return { sitekey: siteKey, theme: "auto", language: "fr", action: LEAD_CHALLENGE_ACTION, cData: slug };
}

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Injects Cloudflare's script on first call only; a failed load (`onerror`, or `onload` without the API) can be retried by the next call. */
export function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    const fail = (message: string) => {
      script.remove();
      loading = null;
      reject(new Error(message));
    };
    script.onload = () => (window.turnstile === undefined ? fail("turnstile: api missing") : resolve(window.turnstile));
    script.onerror = () => fail("turnstile: script failed to load");
    document.head.append(script);
  });
  return loading;
}
