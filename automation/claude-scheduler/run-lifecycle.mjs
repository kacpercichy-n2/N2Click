export async function initializeRunLifecycle({ dryRun, writeRunning, readUsage }) {
  if (!dryRun) writeRunning();
  return readUsage ? readUsage() : null;
}

export function shouldBlockRunOnShutdown(activeRun) {
  return activeRun !== null && activeRun.commitSucceeded !== true;
}
