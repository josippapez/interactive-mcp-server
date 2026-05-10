/**
 * Tests for the MCP port-probe utility.
 */

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { isPortFree, resolveMcpPort } from './port-probe';

function listenOn(port: number): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () => {
          server.close();
        },
      });
    });
  });
}

// Pick a base in the high range to avoid collisions with anything the
// developer's machine may have running.
const BASE = 51000;

describe('isPortFree', () => {
  it('returns true for a port nothing is bound on', async () => {
    const free = await isPortFree(BASE + 1);
    expect(free).toBe(true);
  });

  it('returns false for a port we are listening on', async () => {
    const port = BASE + 2;
    const server = await listenOn(port);
    try {
      const free = await isPortFree(port);
      expect(free).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe('resolveMcpPort', () => {
  it('returns startPort when free', async () => {
    const port = BASE + 10;
    const result = await resolveMcpPort(port);
    expect(result.port).toBe(port);
    expect(result.attempts).toBe(1);
  });

  it('probes upward when startPort is busy', async () => {
    const port = BASE + 20;
    const server = await listenOn(port);
    try {
      const result = await resolveMcpPort(port);
      expect(result.port).toBe(port + 1);
      expect(result.attempts).toBe(2);
    } finally {
      server.close();
    }
  });
});
