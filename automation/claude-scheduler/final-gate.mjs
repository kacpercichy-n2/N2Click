export function finalGateError({ reviewedDiffHash, currentDiffHash, branchError }) {
  if (branchError) return `post-verification branch safety failed: ${branchError}`;
  if (reviewedDiffHash !== currentDiffHash) return "canonical diff changed during final verification";
  return null;
}
