// Form-level dirtiness registry, consulted at storage-event time to decide
// whether an external same-browser tab write can be applied IN PLACE (clean
// tab) or must raise a CONFLICT (dirty tab). Deliberately tiny and pure: no
// React, no storage. The UI package wires `useSaveStatus` to register each open
// form's dirty flag here by a stable object key (one identity per form). A
// failed local write is treated as dirty by the provider (in-memory state has
// already diverged from storage) independently of this registry.
const dirtyFlags = new Map<object, boolean>();

/** Record whether the form identified by `key` currently has unsaved edits. */
export function setDirtyFlag(key: object, dirty: boolean): void {
  dirtyFlags.set(key, dirty);
}

/** Forget a form entirely (e.g. on unmount) so it can never read as dirty. */
export function clearDirtyFlag(key: object): void {
  dirtyFlags.delete(key);
}

/** True iff any registered form currently reports itself dirty. */
export function anyDirty(): boolean {
  for (const dirty of dirtyFlags.values()) {
    if (dirty) return true;
  }
  return false;
}
