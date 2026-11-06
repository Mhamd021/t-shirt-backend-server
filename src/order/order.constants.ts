export const LEASE_MINUTES = 5;
export const BATCH = 10;
export const MAX_NOTIFY_ATTEMPTS = 5;
export const DEFAULT_TICK_BUDGET_MS = 30_000;
export const DEFAULT_POLL_BUDGET_MS = 4_000;
export const MAX_TICK_BUDGET_MS = 45_000;

export function getTickBudgetMs(
  value: string | undefined,
  fallbackMs = DEFAULT_TICK_BUDGET_MS,
): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(raw, MAX_TICK_BUDGET_MS)
    : fallbackMs;
}