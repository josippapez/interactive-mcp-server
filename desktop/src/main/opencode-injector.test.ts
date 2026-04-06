import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';

// Mock the attachment-store module so we don't write to the real userData dir
vi.mock('./attachment-store', () => ({
  saveAttachment: vi.fn(() => 'test-uuid.png'),
  attachmentUrl: vi.fn(
    (filename: string, port: number) =>
      `http://localhost:${port}/attachments/${filename}`,
  ),
}));

import { injectOpenCodeMessage } from '../main/opencode-injector';

// ---------------------------------------------------------------------------
// Test HTTP server that simulates the OpenCode /session/:id/message endpoint
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
  });

  it('sends a POST to /session/:id/message with correct URL', async () => {
    const result = await injectOpenCodeMessage(
      'session-abc',
      'Hello agent',
      undefined,
      serverPort,
    );

    expect(result.ok).toBe(true);
    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.url).toBe('/session/session-abc/message');
  });

  it('defaults noReply to false when not specified', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort);

    const body = JSON.parse(lastRequest!.body);
    expect(body.noReply).toBe(false);
  });

  it('sends noReply: true when explicitly set', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort, true);

    const body = JSON.parse(lastRequest!.body);
    expect(body.noReply).toBe(true);
  });

  it('sends noReply: false when explicitly set', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort, false);

    const body = JSON.parse(lastRequest!.body);
    expect(body.noReply).toBe(false);
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
      false,
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
    expect(result.error).toContain('500');
  });

  it('returns ok: false when the server is unreachable', async () => {
    await stopServer();

    const result = await injectOpenCodeMessage('s1', 'test', undefined, 1);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('URL-encodes the session ID', async () => {
    await injectOpenCodeMessage(
      'session with spaces/and?special',
      'test',
      undefined,
      serverPort,
    );

    expect(lastRequest!.url).toBe(
      '/session/session%20with%20spaces%2Fand%3Fspecial/message',
    );
  });

  it('sends Content-Type: application/json', async () => {
    await injectOpenCodeMessage('s1', 'test', undefined, serverPort);

    expect(lastRequest!.headers['content-type']).toBe('application/json');
  });
});
