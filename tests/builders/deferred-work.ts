/**
 * Stand-in for `after()` of `next/server` in route handler tests: the tasks are kept, then run by `flush()` once the
 * response has been returned. A function or a promise is accepted, as `after()` does. A failing task is collected in
 * `failures` (Next.js logs it; it never reaches the response).
 */
export type AfterTask = (() => unknown) | PromiseLike<unknown>;

export type DeferredWork = {
  readonly tasks: AfterTask[];
  readonly failures: unknown[];
  after(task: AfterTask): void;
  flush(): Promise<void>;
  reset(): void;
};

export function makeDeferredWork(): DeferredWork {
  const tasks: AfterTask[] = [];
  const failures: unknown[] = [];
  return {
    tasks,
    failures,
    after(task) {
      tasks.push(task);
    },
    async flush() {
      for (const task of tasks.splice(0)) {
        try {
          await (typeof task === "function" ? task() : task);
        } catch (error) {
          failures.push(error);
        }
      }
    },
    reset() {
      tasks.length = 0;
      failures.length = 0;
    },
  };
}

/** Resolves to "pending" when `promise` has not settled within a few event-loop turns. */
export async function settlesBeforeTimeout<T>(promise: Promise<T>, ms = 200): Promise<T | "pending"> {
  return Promise.race([promise, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);
}
