export function finalizeWithFailureGuard(action, onFailure) {
  try {
    action();
    return null;
  } catch (error) {
    onFailure(error);
    return error;
  }
}

export function runNonFatalTelemetry(action, onFailure) {
  try {
    action();
    return null;
  } catch (error) {
    onFailure(error);
    return error;
  }
}

export async function runNonFatalTelemetryAsync(action, onFailure) {
  try {
    return await action();
  } catch (error) {
    onFailure(error);
    return null;
  }
}
