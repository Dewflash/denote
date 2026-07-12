// src/services/keychain.ts — the TS bridge to the macOS Keychain (D13). The Anthropic API key
// lives ONLY in the Keychain — never in vaults, never in `settings.json`, never in env vars. The
// UI shows presence + a "test key" button; it never reads the key value back into JS beyond the
// moment it hands a freshly-typed key to `setAnthropicKey`. Three Rust commands (keychain.rs) back
// this; the lazy `@tauri-apps` import keeps the module importable in node tests.

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> =>
  import('@tauri-apps/api/core').then((m) => m.invoke<T>(cmd, args));

export const KEYCHAIN_ACCOUNT = 'anthropic-api-key';

/** Store (or replace) the Anthropic API key in the Keychain. */
export function setAnthropicKey(key: string): Promise<void> {
  return invoke('keychain_set', { account: KEYCHAIN_ACCOUNT, secret: key });
}

/** Whether a key is present — used only to render presence in Settings (never the value). */
export function hasAnthropicKey(): Promise<boolean> {
  return invoke<boolean>('keychain_has', { account: KEYCHAIN_ACCOUNT });
}

/** Remove the key from the Keychain. */
export function clearAnthropicKey(): Promise<void> {
  return invoke('keychain_delete', { account: KEYCHAIN_ACCOUNT });
}

/** Fetch the key for a backend call. NOT exposed to UI — only the anthropic transport uses it. */
export function readAnthropicKey(): Promise<string | null> {
  return invoke<string | null>('keychain_get', { account: KEYCHAIN_ACCOUNT }).catch(() => null);
}
