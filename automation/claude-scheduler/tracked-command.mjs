import { spawn } from "node:child_process";

export function runTrackedCommand({
  command,
  args,
  cwd,
  env,
  input = null,
  timeoutMs = null,
  timeoutGraceMs = 10_000,
  closeGraceMs = 1_000,
  guard,
  capture = false,
  onStdout = () => {},
  onStderr = () => {},
  onLog = () => {},
}) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let terminationInProgress = false;
    let timeout = null;
    let stdout = "";
    let stderr = "";

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(capture ? { code, stdout, stderr } : code);
    };

    const terminateThenFinish = (code, graceMs, failureLabel) => {
      terminationInProgress = true;
      void guard.terminate(graceMs)
        .then((confirmed) => {
          if (!confirmed) onLog(`[${failureLabel}; process group still active and scheduler lock is retained]\n`);
          finish(confirmed ? code : (code === 124 ? 124 : 125));
        })
        .catch((error) => {
          onLog(`[${failureLabel}: ${error.message}; scheduler lock is retained]\n`);
          finish(code === 124 ? 124 : 125);
        });
    };

    if (guard.active) {
      onLog(`[${command} was not started because another tracked process group is still active]\n`);
      finish(125);
      return;
    }

    try {
      child = spawn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      guard.track(child);
    } catch (error) {
      onLog(`\n[${command || "missing command"} failed to launch: ${error.message}]\n`);
      finish(127);
      return;
    }

    child.stdin.on("error", (error) => {
      if (settled || terminationInProgress) return;
      onLog(`\n[${command} stdin failed: ${error.message}]\n`);
      terminateThenFinish(126, closeGraceMs, `${command} stdin cleanup could not be confirmed`);
    });
    child.stdin.end(input || "");
    child.stdout.on("data", (chunk) => {
      if (capture) stdout += chunk;
      onStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (capture) stderr += chunk;
      onStderr(chunk);
    });

    if (timeoutMs) {
      timeout = setTimeout(() => {
        if (settled) return;
        onLog(`\n[${command} exceeded ${timeoutMs}ms; terminating its process group]\n`);
        terminateThenFinish(124, timeoutGraceMs, `${command} timeout termination could not be confirmed`);
      }, timeoutMs);
    }

    child.on("error", (error) => {
      if (settled || terminationInProgress) return;
      onLog(`\n[${command || "missing command"} failed to launch: ${error.message}]\n`);
      terminateThenFinish(127, closeGraceMs, `${command || "missing command"} launch cleanup could not be confirmed`);
    });
    child.on("close", (code) => {
      if (settled || terminationInProgress) return;
      if (timeout) clearTimeout(timeout);
      const exitCode = code ?? 1;
      void guard.terminate(closeGraceMs).then((confirmed) => {
        const finalCode = confirmed ? exitCode : 125;
        onLog(`\n[${command} exited with code ${finalCode}${confirmed ? "" : "; process group still active"}]\n`);
        finish(finalCode);
      });
    });
  });
}
