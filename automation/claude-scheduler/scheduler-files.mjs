import fs from "node:fs";
import path from "node:path";

export function finalizePrompt({ promptFile, archiveDir, commit, unstage }) {
  const destination = path.join(archiveDir, path.basename(promptFile));
  fs.mkdirSync(archiveDir, { recursive: true });
  if (fs.existsSync(destination)) {
    throw new Error(`Cannot archive ${promptFile}: ${destination} already exists.`);
  }
  fs.renameSync(promptFile, destination);
  try {
    commit();
  } catch (error) {
    fs.renameSync(destination, promptFile);
    unstage();
    throw error;
  }
  return destination;
}
