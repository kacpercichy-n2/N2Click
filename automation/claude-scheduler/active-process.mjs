export class ActiveProcessGuard {
  #child = null;
  #processGroupId = null;

  track(child) {
    if (this.active) throw new Error("another scheduler child is already active");
    this.#child = child;
    this.#processGroupId = Number.isInteger(child.pid) ? child.pid : null;
    child.once("close", () => {
      if (this.#child === child && !this.#groupExists()) this.#clear();
    });
  }

  get active() {
    if (this.#child && !this.#groupExists()) this.#clear();
    return this.#child !== null;
  }

  async terminate(timeoutMs = 10_000) {
    const child = this.#child;
    if (!child) return true;
    const processGroupId = this.#processGroupId;
    killGroup(processGroupId, child, "SIGTERM");
    if (await waitForGroupExit(processGroupId, child, timeoutMs)) {
      this.#clear();
      return true;
    }
    killGroup(processGroupId, child, "SIGKILL");
    if (await waitForGroupExit(processGroupId, child, 1_000)) {
      this.#clear();
      return true;
    }
    return false;
  }

  #groupExists() {
    return groupExists(this.#processGroupId, this.#child);
  }

  #clear() {
    this.#child = null;
    this.#processGroupId = null;
  }
}

function waitForGroupExit(processGroupId, child, timeoutMs) {
  return new Promise((resolve) => {
    if (!groupExists(processGroupId, child)) return resolve(true);
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (!groupExists(processGroupId, child)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 25);
    };
    setTimeout(poll, 25);
  });
}

function groupExists(processGroupId, child) {
  if (processGroupId !== null) {
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      return error?.code !== "ESRCH";
    }
  }
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function killGroup(processGroupId, child, signal) {
  try {
    if (processGroupId === null) throw new Error("process group unavailable");
    process.kill(-processGroupId, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The close/timeout path decides whether termination was confirmed.
    }
  }
}
