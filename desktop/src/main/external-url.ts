// Links leave the app through shell.openExternal, which hands any scheme to the OS (file:,
// smb:, custom protocol handlers). Retry banners show links supplied by the provider, so only
// web and mail links are opened.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
