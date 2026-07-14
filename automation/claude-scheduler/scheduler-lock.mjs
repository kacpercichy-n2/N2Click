import fs from "node:fs";

export function acquireSchedulerLock(lockFile, pid = process.pid) {
  try {
    const fd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(fd, `${pid}\n`);
    fs.closeSync(fd);
    return () => releaseSchedulerLock(lockFile, pid);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number.parseInt(readLock(lockFile), 10);
    if (Number.isInteger(owner) && processIsAlive(owner)) {
      throw new Error(`scheduler is already running with PID ${owner}`);
    }
    throw new Error(
      `stale scheduler lock has unknown invocation state; verify no model process remains, then remove ${lockFile}`,
    );
  }
}

function releaseSchedulerLock(lockFile, pid) {
  const owner = Number.parseInt(readLock(lockFile), 10);
  if (owner === pid) fs.rmSync(lockFile, { force: true });
}

function readLock(lockFile) {
  try {
    return fs.readFileSync(lockFile, "utf8").trim();
  } catch {
    return "";
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
