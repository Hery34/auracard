import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5000;

const TOKEN_ERRORS = new Set(["invalid-input-response", "missing-input-response", "timeout-or-duplicate"]);
const LOG_SOURCE = "turnstile";

/**
 * Server-side check of a Turnstile token (ADR 0008). Only `secret` and `response` are sent (no `remoteip`, no
 * `idempotency_key`): each token is validated once by Cloudflare. Only token errors refuse; anything else is `unavailable`.
 * `action` and `cdata` bind the token to the form and the profile (0032, decision 14): siteverify does not take them,
 * the answer must echo the expected values. Only Cloudflare's test secrets (`metadata.result_with_testing_key`) may
 * omit them; `env.ts` refuses those keys in public production.
 */
export function makeTurnstileVerifier(deps: {
  secretKey: string;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}): BotChallengeVerifier {
  return {
    async verify({ token, expectedAction, expectedCData }) {
      const body = new URLSearchParams({ secret: deps.secretKey, response: token });
      let payload: unknown;
      try {
        const response = await deps.fetch(TURNSTILE_SITEVERIFY_URL, {
          method: "POST",
          body,
          redirect: "error",
          signal: AbortSignal.timeout(deps.timeoutMs),
        });
        if (!response.ok) {
          logInfrastructureError(LOG_SOURCE, `http_${response.status}`);
          return err("unavailable");
        }
        payload = await response.json();
      } catch (error) {
        logInfrastructureError(LOG_SOURCE, isTimeout(error) ? "timeout" : "request_failed");
        return err("unavailable");
      }

      const answer = parseAnswer(payload);
      if (answer === null) {
        logInfrastructureError(LOG_SOURCE, "malformed_answer");
        return err("unavailable");
      }
      if (answer.success) {
        const binding = checkBinding(payload as Record<string, unknown>, expectedAction, expectedCData);
        if (binding === "malformed") {
          logInfrastructureError(LOG_SOURCE, "malformed_answer");
          return err("unavailable");
        }
        return ok({ passed: binding === "match" });
      }
      const otherError = answer.errorCodes.find((code) => !TOKEN_ERRORS.has(code));
      if (otherError !== undefined) {
        logInfrastructureError(LOG_SOURCE, /^[a-z-]{1,64}$/.test(otherError) ? otherError : "unexpected_error_code");
        return err("unavailable");
      }
      return ok({ passed: false });
    },
  };
}

function parseAnswer(payload: unknown): { success: boolean; errorCodes: string[] } | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const { success, "error-codes": errorCodes } = payload as Record<string, unknown>;
  if (typeof success !== "boolean") {
    return null;
  }
  if (errorCodes === undefined) {
    return { success, errorCodes: [] };
  }
  if (!Array.isArray(errorCodes) || !errorCodes.every((code) => typeof code === "string")) {
    return null;
  }
  return { success, errorCodes };
}

function checkBinding(
  payload: Record<string, unknown>,
  expectedAction: string,
  expectedCData: string,
): "match" | "mismatch" | "malformed" {
  const { action, cdata, metadata } = payload;
  if ((action !== undefined && typeof action !== "string") || (cdata !== undefined && typeof cdata !== "string")) {
    return "malformed";
  }
  if ((action !== undefined && action !== expectedAction) || (cdata !== undefined && cdata !== expectedCData)) {
    return "mismatch";
  }
  if (action !== undefined && cdata !== undefined) {
    return "match";
  }
  return isTestingKeyAnswer(metadata) ? "match" : "malformed";
}

function isTestingKeyAnswer(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).result_with_testing_key === true
  );
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}
