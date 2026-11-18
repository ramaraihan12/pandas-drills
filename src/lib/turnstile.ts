// Cloudflare Turnstile, used on the "new class" page only. The script is not loaded anywhere else,
// and students never see it: joining a class and sending checks have no bot check.
export const TURNSTILE_SITEKEY: string = ((import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? "").trim();
export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback"?: () => void;
    },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

/** Adds the Turnstile script the first time it is asked for. A failed load can be retried. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      script.remove();
      loading = undefined;
      reject(new Error("turnstile blocked"));
    };
    document.head.append(script);
  });
  return loading;
}

export const BOT_CHECK_TEXT = {
  loading: "Loading the bot check...",
  ready: "Please wait for the bot check to finish, then press Create.",
  expired: "The bot check expired. Please complete it again.",
  error: "The bot check could not finish. Please try again, or reload the page.",
  blocked: "The bot check could not load. Check your connection or any content blocker, then reload the page.",
  missing: "Class creation is not set up on this site yet.",
} as const;
