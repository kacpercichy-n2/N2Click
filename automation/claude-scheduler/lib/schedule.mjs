// Pure scheduling decisions for the prompt scheduler.
//
// All time arithmetic uses epoch/Date math on the UTC ISO reset value, never
// local-time string math.

export const USAGE_CHAIN_LIMIT = 50;
export const RESET_ANCHOR_MS = 60_000; // run one minute after the usage reset

// Epoch ms at which the next prompt may run: reset + 60s.
// null/unparseable reset -> null. A stale reset already in the past -> nowMs
// (run now; the caller refetches usage once first).
export function computeNextRunAt(resetsAtIso, nowMs) {
  if (!resetsAtIso) return null;
  const parsed = Date.parse(resetsAtIso);
  if (Number.isNaN(parsed)) return null;
  const target = parsed + RESET_ANCHOR_MS;
  return target <= nowMs ? nowMs : target;
}

// Decide whether to chain immediately, wait for the reset, or retry the usage
// fetch. Exactly 50% waits.
export function chainDecision(usage) {
  if (!usage || !Number.isFinite(usage.utilization)) return "retry-usage";
  return usage.utilization < USAGE_CHAIN_LIMIT ? "chain" : "wait";
}
