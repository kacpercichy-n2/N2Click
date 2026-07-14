export function queueStopReason({ ok, activeProcess, continueOnError }) {
  if (activeProcess) return "active-process";
  if (!ok && !continueOnError) return "failed-run";
  return null;
}
