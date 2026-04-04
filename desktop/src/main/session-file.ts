import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const SESSION_FILE = join(tmpdir(), 'imcp-session.json');
// Also write to CWD-based path for repo-local persistence
export const CWD_SESSION_FILE = join(process.cwd(), '.imcp-session');

export function writeSessionFile(sessionId: string, port: number): void {
  const data = JSON.stringify({ sessionId, port });
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      writeFileSync(path, data, 'utf-8');
    } catch {
      // non-critical
    }
  }
}

export function clearSessionFile(): void {
  for (const path of [SESSION_FILE, CWD_SESSION_FILE]) {
    try {
      unlinkSync(path);
    } catch {
      // non-critical
    }
  }
}
