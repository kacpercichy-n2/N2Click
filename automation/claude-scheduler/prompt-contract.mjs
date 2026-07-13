import fs from "node:fs";
import path from "node:path";

const REQUIRED_SECTIONS = [
  "Risk and routing",
  "Wiki context",
  "Expected touchpoints",
  "Invariants",
  "Scope",
  "Out of scope",
  "Acceptance",
  "Verification",
];
const ALLOWED_ROUTES = new Set([
  "developer → reviewer",
  "test-writer → reviewer",
  "architect → developer → reviewer",
  "architect → reviewer",
]);

export function promptContractErrorFor(promptBody, repoRoot) {
  for (const section of REQUIRED_SECTIONS) {
    const body = sectionBody(promptBody, section);
    if (body === null) return `missing a ## ${section} section`;
    if (!body.trim()) return `## ${section} must not be empty`;
  }

  const wikiBody = sectionBody(promptBody, "Wiki context");
  const wikiPaths = backtickedValues(wikiBody).filter((value) =>
    /^openwiki\/n2hub\/[\w-]+\.md$/.test(value),
  );
  if (wikiPaths.length === 0) {
    return "## Wiki context must list at least one openwiki/n2hub page in backticks";
  }
  for (const wikiPath of wikiPaths) {
    if (!fs.existsSync(path.join(repoRoot, wikiPath))) {
      return `wiki context path does not exist: ${wikiPath}`;
    }
  }

  const touchpointBody = sectionBody(promptBody, "Expected touchpoints");
  const touchpoints = backtickedValues(touchpointBody);
  if (touchpoints.length === 0) {
    return "## Expected touchpoints must list at least one path in backticks";
  }
  for (const declaredTouchpoint of touchpoints) {
    const planned = declaredTouchpoint.startsWith("new: ");
    const touchpoint = planned ? declaredTouchpoint.slice(5).trim() : declaredTouchpoint;
    if (touchpoint.includes("...") || touchpoint.includes("<")) {
      return `touchpoint must be concrete: ${touchpoint}`;
    }
    const pathError = repositoryPathError(touchpoint, repoRoot);
    if (pathError) return pathError;
    if (planned) {
      if (touchpoint.includes("*")) return `planned touchpoint cannot be a glob: ${touchpoint}`;
      const parent = path.dirname(path.join(repoRoot, touchpoint));
      if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
        return `planned touchpoint parent does not exist: ${touchpoint}`;
      }
      const realParent = fs.realpathSync(parent);
      if (!isWithinOrEqual(fs.realpathSync(repoRoot), realParent)) {
        return `planned touchpoint resolves outside the repository: ${touchpoint}`;
      }
      continue;
    }
    const matches = touchpoint.includes("*")
      ? fs.globSync(touchpoint, { cwd: repoRoot })
      : fs.existsSync(path.join(repoRoot, touchpoint))
        ? [touchpoint]
        : [];
    if (matches.length === 0) return `touchpoint does not exist: ${touchpoint}`;
    for (const match of matches) {
      if (fs.statSync(path.join(repoRoot, match)).isDirectory()) {
        return `touchpoint must name a file or file glob: ${touchpoint}`;
      }
      const realMatch = fs.realpathSync(path.join(repoRoot, match));
      if (!isWithin(fs.realpathSync(repoRoot), realMatch)) {
        return `touchpoint resolves outside the repository: ${touchpoint}`;
      }
    }
  }

  const metadata = promptMetadata(promptBody);
  if (!metadata.risk) return "## Risk and routing must declare - Risk: low | medium | high";
  if (!metadata.route) return "## Risk and routing must declare - Route: <agent sequence>";
  if (!ALLOWED_ROUTES.has(metadata.route)) return `unsupported route: ${metadata.route}`;
  if (!metadata.codexReview) {
    return "## Risk and routing must declare - Codex review: required | conditional | skip";
  }
  if (metadata.risk === "high" && metadata.codexReview !== "required") {
    return "high-risk prompts must require Codex review";
  }
  if (["conditional", "skip"].includes(metadata.codexReview) && !metadata.codexRationale) {
    return `${metadata.codexReview} Codex review must include a rationale after —`;
  }

  return null;
}

export function promptMetadata(promptBody) {
  const body = sectionBody(promptBody, "Risk and routing") || "";
  const codex = codexPolicy(fieldRaw(body, "Codex review"));
  return {
    risk: fieldValue(body, "Risk", ["low", "medium", "high"]),
    route: fieldRaw(body, "Route"),
    codexReview: codex.policy,
    codexRationale: codex.rationale,
  };
}

export function sectionBody(promptBody, heading) {
  const lines = promptBody.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function backtickedValues(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
}

function fieldValue(body, label, allowedValues = null) {
  const raw = fieldRaw(body, label);
  if (!raw) return null;
  if (!allowedValues) return raw;
  const normalized = raw.split(/\s|—|-/)[0].toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function fieldRaw(body, label) {
  const match = body.match(new RegExp(`^-\\s*${escapeRegExp(label)}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function codexPolicy(raw) {
  if (!raw) return { policy: null, rationale: null };
  const match = raw.match(/^(required|conditional|skip)(?:\s+[—-]\s+(.+))?$/i);
  return match
    ? { policy: match[1].toLowerCase(), rationale: match[2]?.trim() || null }
    : { policy: null, rationale: null };
}

function repositoryPathError(value, repoRoot) {
  if (path.isAbsolute(value)) return `touchpoint must be repository-relative: ${value}`;
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return `touchpoint escapes the repository: ${value}`;
  }
  const resolved = path.resolve(repoRoot, normalized);
  if (!isWithin(path.resolve(repoRoot), resolved)) return `touchpoint escapes the repository: ${value}`;
  return null;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isWithinOrEqual(root, candidate) {
  return path.resolve(root) === path.resolve(candidate) || isWithin(root, candidate);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
