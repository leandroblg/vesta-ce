import { MAX_LOG_CONTEXT_CHARS, MAX_LOG_MESSAGE_CHARS, MAX_LOG_STACK_CHARS } from "../domain/limits";
/** Sends renderer errors to the main-process log (FR-040); the console copy helps during development. */
export function reportError(context: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  const rawStack = err instanceof Error ? (err.stack ?? null) : null;
  // 010 L1 (FR-009): cut to the contract's limits here, so an oversized error is still recorded.
  const message = raw.slice(0, MAX_LOG_MESSAGE_CHARS);
  const stack = rawStack === null ? null : rawStack.slice(0, MAX_LOG_STACK_CHARS);
  console.error(context, err);
  try {
    void window.vesta.app.logError({ message, stack, context: context.slice(0, MAX_LOG_CONTEXT_CHARS) }).catch(() => undefined);
  } catch {
    // the bridge itself failed; nothing more can be done
  }
}
