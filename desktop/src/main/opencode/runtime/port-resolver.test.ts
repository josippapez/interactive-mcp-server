import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';

import {
  isPortFree,
  resolveOpenCodePort,
  writePidfile,
  clearPidfile,
} from './port-resolver';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'port-resolver-test-'));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.once('listening', () => resolve(srv));
    srv.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

function close(srv: Server): Promise<void> {
  return new Promise((resolve) => srv.close(() => resolve()));
}

describe('isPortFree', () => {
  it('returns true for an unused port', async () => {
    // High random port, very unlikely to be in use.
    const port = 40000 + Math.floor(Math.random() * 10000);
    expect(await isPortFree(port)).toBe(true);
  });

  it('returns false for a port currently held', async () => {
    const port = 40000 + Math.floor(Math.random() * 10000);
    const srv = await listenOn(port);
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await close(srv);
    }
  });
});

describe('resolveOpenCodePort', () => {
  it('returns the start port when free', async () => {
    const startPort = 41000 + Math.floor(Math.random() * 1000);
    const result = await resolveOpenCodePort({
      userDataPath: tmpDir,
      startPort,
      log: () => undefined,
    });
    expect(result.port).toBe(startPort);
    expect(result.attempts).toBe(1);
  });

  it('probes upward when start port is in use', async () => {
    const startPort = 42000 + Math.floor(Math.random() * 1000);
    const blocker = await listenOn(startPort);
    try {
      const result = await resolveOpenCodePort({
        userDataPath: tmpDir,
        startPort,
        log: () => undefined,
      });
      expect(result.port).toBe(startPort + 1);
      expect(result.attempts).toBe(2);
    } finally {
      await close(blocker);
    }
  });

  it('throws when no free port is found in range', async () => {
    const startPort = 43000 + Math.floor(Math.random() * 100);
    const blockers: Server[] = [];
    try {
      // Block 3 consecutive ports, then ask for max=3 attempts.
      for (let i = 0; i < 3; i += 1) {
        blockers.push(await listenOn(startPort + i));
      }
      await expect(
        resolveOpenCodePort({
          userDataPath: tmpDir,
          startPort,
          maxAttempts: 3,
          log: () => undefined,
        }),
      ).rejects.toThrow(/no free port found/);
    } finally {
      for (const b of blockers) await close(b);
    }
  });

  it('does not touch foreign processes holding the port', async () => {
    // Simulate a foreign process by listening ourselves but with a random
    // pid recorded to the pidfile (not matching our actual pid).
    const startPort = 44000 + Math.floor(Math.random() * 1000);
    const foreign = await listenOn(startPort);
    try {
      // Pidfile points at a non-existent pid, NOT the foreign listener.
      writePidfile(tmpDir, 999_999_999);
      const logs: string[] = [];
      const result = await resolveOpenCodePort({
        userDataPath: tmpDir,
        startPort,
        log: (m) => logs.push(m),
      });
      // Should have probed upward (foreign listener still alive).
      expect(result.port).toBe(startPort + 1);
      expect(logs.some((l) => l.includes('reclaim'))).toBe(false);
    } finally {
      await close(foreign);
      clearPidfile(tmpDir);
    }
  });
});
