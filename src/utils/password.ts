// Cosmetic client-side password gating ONLY.
//
// This is a localStorage-only app with no backend. Hashing the password with a
// bare SHA-256 (no salt, no KDF, no server) is NOT secure credential storage —
// it exists purely to gate the LOCAL UI so the single-machine demo can feel
// multi-user. Anyone with the localStorage payload can read every hash and brute
// a short password instantly. Do NOT treat these hashes as protecting anything.
//
// This whole module is a placeholder for the storage.ts→API migration: real auth
// (salted KDF, server-side verification, sessions) lands with the API. Keep the
// two-function surface (hashPassword / verifyPassword) so the swap is local.
//
// WebCrypto (crypto.subtle) is available on secure contexts / localhost and in
// vitest's node env (Node ≥ 20) — no polyfill needed.

/** SHA-256 hex digest of a plaintext password. */
export async function hashPassword(plain: string): Promise<string> {
  const bytes = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when `plain` hashes to `hash`. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await hashPassword(plain)) === hash;
}
