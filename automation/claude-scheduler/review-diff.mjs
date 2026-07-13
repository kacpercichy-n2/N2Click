import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const EXCLUDED_PATHS = [
  ":(exclude)handoffs/RUN-STATE.md",
  ":(exclude)handoffs/RUN-RESULT.json",
];

export function buildReviewDiff(repoRoot, baseCommit = null) {
  const range = baseCommit ? [`${baseCommit}..HEAD`] : ["HEAD"];
  let diff = git(repoRoot, ["diff", "--binary", ...range, "--", ".", ...EXCLUDED_PATHS]);
  let files = lines(git(repoRoot, ["diff", "--name-only", ...range, "--", ".", ...EXCLUDED_PATHS]));

  if (!baseCommit) {
    const untracked = lines(git(repoRoot, ["ls-files", "--others", "--exclude-standard"]))
      .filter((file) => !["handoffs/RUN-STATE.md", "handoffs/RUN-RESULT.json"].includes(file));
    for (const file of untracked) {
      const result = spawnSync("git", ["diff", "--no-index", "--binary", "--", "/dev/null", file], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
      });
      if (![0, 1].includes(result.status)) throw new Error(result.stderr || `cannot diff ${file}`);
      diff = joinDiff(diff, result.stdout);
      files.push(file);
    }
  }

  return {
    diff,
    files: [...new Set(files)].sort(),
    hash: createHash("sha256").update(diff).digest("hex"),
  };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function joinDiff(left, right) {
  if (!left) return right;
  if (!right) return left;
  return `${left.replace(/\n+$/, "")}\n${right}`;
}
