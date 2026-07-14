// Atomic heartbeat writer for state/status.json.
//
// Writes to a temp file then renames, so a reader (the monitor) never observes
// a half-written file.

import fs from "node:fs";

export function writeStatus(filePath, status) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(status, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function readStatus(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
