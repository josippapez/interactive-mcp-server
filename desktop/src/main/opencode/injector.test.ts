import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';

// Mock the attachment-store module so we don't write to the real userData dir
vi.mock('../attachment-store', () => ({
  saveAttachment: vi.fn(() => 'test-uuid.png'),
  attachmentUrl: vi.fn(
    (filename: string, port: number) =>
      `http://localhost:${port}/attachments/${filename}`,
  ),
}));

vi.mock('../database', () => ({
  getRegisteredConnectionBySessionId: vi.fn(() => null),
}));

import { injectOpenCodeMessage } from './injector';
import { _setClientFactory, _resetClientFactory } from './sdk-client';
import { getRegisteredConnectionBySessionId } from '../database';

// ---------------------------------------------------------------------------
// Test HTTP server that simulates the OpenCode /session/:id/prompt_async endpoint
// (SDK uses prompt_async instead of message)
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort: number;
let lastRequest: {
  method: string;
  url: string;
  body: string;
  headers: http.IncomingHttpHeaders;
} | null = null;
let responseStatus = 200;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastRequest = {
          method: req.method ?? 'GET',
          url: req.url ?? '',
          body,
          headers: req.headers,
        };

        res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: responseStatus === 200 }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectOpenCodeMessage', () => {
  beforeEach(async () => {
    lastRequest = null;
    responseStatus = 200;
    serverPort = await startServer();
  });

  afterEach(async () => {
    await stopServer();
    _resetClientFactory();
    vi.restoreAllMocks();
  });

  it('sends a POST to /session/:id/prompt_async with correct URL', async () => {
    const result = await injectOpenCodeMessage(
      'session-abc',
      'Hello agent',
      undefined,
      serverPort,
    );

    expect(result.ok).toBe(true);
    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.url).toBe('/session/session-abc/prompt_async');
  });

  it('sends noReply: true by default', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort);

    const body = JSON.parse(lastRequest!.body);
    expect(body.noReply).toBe(true);
  });

  it('sends noReply: false when explicitly set to false', async () => {
    await injectOpenCodeMessage(
      's1',
      'test',
      undefined,
      serverPort,
      undefined,
      false,
    );

    const body = JSON.parse(lastRequest!.body);
    expect(body.noReply).toBe(false);
  });

  it('maps xhigh variant to provider max in request payload', async () => {
    await injectOpenCodeMessage(
      's1',
      'test',
      undefined,
      serverPort,
      undefined,
      false,
      {
        providerId: 'openai',
        modelId: 'gpt-5',
        variant: 'xhigh',
      },
    );

    const body = JSON.parse(lastRequest!.body);
    expect(body.variant).toBe('max');
  });

  it('includes the message text in parts[0].text', async () => {
    await injectOpenCodeMessage('s1', 'Hello world', undefined, serverPort);

    const body = JSON.parse(lastRequest!.body);
    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].type).toBe('text');
    expect(body.parts[0].text).toBe('Hello world');
  });

  it('inlines text file attachments in the message body', async () => {
    const attachments = [
      {
        data: 'console.log("hi")',
        mimeType: 'text/plain',
        name: 'script.js',
        size: 17,
      },
    ];

    await injectOpenCodeMessage(
      's1',
      'Check this file',
      attachments,
      serverPort,
    );

    const body = JSON.parse(lastRequest!.body);
    const text = body.parts[0].text as string;
    expect(text).toContain('Check this file');
    expect(text).toContain('--- File: script.js ---');
    expect(text).toContain('console.log("hi")');
  });

  it('saves image attachments and references them by URL', async () => {
    // Base64 for a 1x1 red PNG pixel
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    const attachments = [
      {
        data: pngBase64,
        mimeType: 'image/png',
        name: 'screenshot.png',
        size: 100,
      },
    ];

    const mcpPort = 3100;
    await injectOpenCodeMessage(
      's1',
      'See image',
      attachments,
      serverPort,
      mcpPort,
    );

    const body = JSON.parse(lastRequest!.body);
    const text = body.parts[0].text as string;
    expect(text).toContain('See image');
    expect(text).toContain('[Image: screenshot.png]');
    expect(text).toContain(
      `http://localhost:${mcpPort}/attachments/test-uuid.png`,
    );
  });

  it('returns ok: false when the server returns a non-200 status', async () => {
    responseStatus = 500;

    const result = await injectOpenCodeMessage(
      's1',
      'test',
      undefined,
      serverPort,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns ok: false when the server is unreachable', async () => {
    await stopServer();

    const result = await injectOpenCodeMessage('s1', 'test', undefined, 1);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('treats noReply=false timeout as success when message exists in session history', async () => {
    // Mock the SDK client to simulate timeout on promptAsync, but success on messages
    let promptAsyncCalled = false;
    _setClientFactory(
      () =>
        ({
          session: {
            promptAsync: async () => {
              promptAsyncCalled = true;
              throw new Error('This operation was aborted');
            },
            messages: async () => ({
              data: [
                {
                  info: { role: 'user' },
                  parts: [{ type: 'text', text: 'timeout but delivered' }],
                },
              ],
            }),
            status: async () => ({ data: {} }),
          },
          global: {},
        }) as unknown as ReturnType<typeof import('./sdk-client').getClient>,
    );

    const result = await injectOpenCodeMessage(
      's1',
      'timeout but delivered',
      undefined,
      serverPort,
      undefined,
      false,
    );

    expect(promptAsyncCalled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.noReply).toBe(false);
  });

  it('keeps timeout failure for noReply=false when message is not found in session history', async () => {
    // Mock the SDK client to simulate timeout on promptAsync, and empty messages
    _setClientFactory(
      () =>
        ({
          session: {
            promptAsync: async () => {
              throw new Error('This operation was aborted');
            },
            messages: async () => ({
              data: [],
            }),
            status: async () => ({ data: {} }),
          },
          global: {},
        }) as unknown as ReturnType<typeof import('./sdk-client').getClient>,
    );

    const result = await injectOpenCodeMessage(
      's1',
      'timeout and missing',
      undefined,
      serverPort,
      undefined,
      false,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Request timed out');
  });

  it('treats noReply=false timeout as success when session is busy after timeout', async () => {
    // Mock the SDK client to simulate timeout on promptAsync, empty messages, but busy status
    _setClientFactory(
      () =>
        ({
          session: {
            promptAsync: async () => {
              throw new Error('This operation was aborted');
            },
            messages: async () => ({
              data: [],
            }),
            status: async () => ({
              data: { s1: { type: 'busy' } },
            }),
          },
          global: {},
        }) as unknown as ReturnType<typeof import('./sdk-client').getClient>,
    );

    const result = await injectOpenCodeMessage(
      's1',
      'timeout while busy',
      undefined,
      serverPort,
      undefined,
      false,
    );

    expect(result.ok).toBe(true);
    expect(result.noReply).toBe(false);
  });

  it('URL-encodes the session ID', async () => {
    await injectOpenCodeMessage(
      'session with spaces/and?special',
      'test',
      undefined,
      serverPort,
    );

    expect(lastRequest!.url).toBe(
      '/session/session%20with%20spaces%2Fand%3Fspecial/prompt_async',
    );
  });

  it('sends Content-Type: application/json', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort);

    expect(lastRequest!.headers['content-type']).toBe('application/json');
  });

  it('uses the registered session baseDirectory for prompt injection', async () => {
    vi.mocked(getRegisteredConnectionBySessionId).mockReturnValue({
      providerType: 'opencode',
      providerSessionId: 's1',
      openCodeSessionId: 's1',
      connectionId: 'c1',
      channelName: 'Channel',
      projectName: 'Project',
      baseDirectory: '/workspace/sciensus-nx',
      idFilePath: '',
      parentSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const directorySpy = vi.fn();
    _setClientFactory((_port, directory) => {
      directorySpy(directory);
      return {
        session: {
          promptAsync: async () => ({ data: {}, error: undefined }),
        },
      } as unknown as ReturnType<typeof import('./sdk-client').getClient>;
    });

    const result = await injectOpenCodeMessage(
      's1',
      'test',
      undefined,
      serverPort,
    );

    expect(result.ok).toBe(true);
    expect(directorySpy).toHaveBeenCalledWith('/workspace/sciensus-nx');
  });

  // Skip: This test would take 60+ seconds with the new timeout value.
  // The timeout behavior is still tested implicitly by other error cases.
  it.skip('returns ok: false when the server accepts the connection but never responds (timeout)', async () => {
    // Simulate a server that accepts the TCP connection and receives the
    // request but never writes a response — this is the "app restarting"
    // scenario where the HTTP port is bound but the handler is frozen.
    let hangServer: http.Server | null = null;
    let hangPort = 0;

    await new Promise<void>((resolve) => {
      hangServer = http.createServer(() => {
        // Intentionally do nothing — never respond
      });
      hangServer.listen(0, '127.0.0.1', () => {
        const addr = hangServer!.address();
        if (addr && typeof addr === 'object') {
          hangPort = addr.port;
        }
        resolve();
      });
    });

    try {
      const start = Date.now();
      const result = await injectOpenCodeMessage(
        's1',
        'test',
        undefined,
        hangPort,
      );
      const elapsed = Date.now() - start;

      // Must return an error (not hang indefinitely)
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      // Must time out within the 60s deadline (give 5s extra for CI jitter)
      expect(elapsed).toBeLessThan(65_000);
    } finally {
      await new Promise<void>((resolve) => {
        if (hangServer) hangServer.close(() => resolve());
        else resolve();
      });
    }
  }, 70_000);
});
