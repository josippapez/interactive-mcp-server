import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './external-url';

describe('isSafeExternalUrl', () => {
  it('allows web and mail links', () => {
    expect(isSafeExternalUrl('https://status.anthropic.com')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:4096/docs')).toBe(true);
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true);
  });

  it('refuses links the OS would hand to another handler', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('smb://evil.example/share')).toBe(false);
    expect(isSafeExternalUrl('vscode://file/tmp/x')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});
