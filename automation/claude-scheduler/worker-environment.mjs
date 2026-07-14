import path from "node:path";

export function buildWorkerEnvironment(env, { isolatedBin, isolatedCodexHome }) {
  return {
    ...env,
    PATH: [isolatedBin, env.PATH || ""].filter(Boolean).join(path.delimiter),
    CODEX_HOME: isolatedCodexHome,
    OPENAI_API_KEY: "",
    NPM_CONFIG_OFFLINE: "true",
  };
}
