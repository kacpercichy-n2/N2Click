export function buildClaudeArgs({
  allowedTools,
  disallowedTools,
  settingSources = "project",
  skipPermissions = false,
}) {
  if (skipPermissions) return ["--print", "--dangerously-skip-permissions"];
  return [
    "--print",
    "--setting-sources",
    settingSources,
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    allowedTools,
    "--disallowedTools",
    disallowedTools,
  ];
}
