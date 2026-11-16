export type CallEntry = { readonly port: string; readonly method: string; readonly input: unknown };

export type CallLog = {
  readonly entries: readonly CallEntry[];
  record(port: string, method: string, input: unknown): void;
  /** Ordered list of `port.method` names, e.g. `["rateLimiter.consume", "auth.signUp"]`. */
  sequence(): string[];
  /** Inputs received by one port method, in call order. */
  inputsOf(port: string, method: string): unknown[];
};

export function makeCallLog(): CallLog {
  const entries: CallEntry[] = [];

  return {
    entries,
    record(port, method, input) {
      entries.push({ port, method, input });
    },
    sequence() {
      return entries.map((entry) => `${entry.port}.${entry.method}`);
    },
    inputsOf(port, method) {
      return entries
        .filter((entry) => entry.port === port && entry.method === method)
        .map((entry) => entry.input);
    },
  };
}

/**
 * Scripted answers for a fake port: results are consumed in order and the last one is repeated,
 * so a single-element script behaves like a constant answer.
 */
export function scriptedResults<T>(results: readonly T[] | undefined, fallback: T): () => T {
  const queue = [...(results ?? [])];

  return () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next ?? fallback;
  };
}
