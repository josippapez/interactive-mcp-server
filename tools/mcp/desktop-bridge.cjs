#!/usr/bin/env node

/**
 * Interactive MCP Desktop Bridge
 *
 * Stdio-to-HTTP bridge that lets OpenCode (or any stdio MCP client) talk to the
 * Interactive MCP Desktop app's Streamable HTTP Transport. OpenCode configures
 * this as a `type: "local"` server so the connection is always alive. The bridge
 * handles retry/reconnect when the desktop app is restarted.
 *
 * Usage:
 *   node tools/mcp/desktop-bridge.cjs [--port <port>]
 *
 * Port resolution (in order):
 *   1. --port CLI argument
 *   2. IMCP_PORT environment variable
 *   3. /tmp/imcp-session.json (written by the desktop app)
 *   4. Default: 3100
 */

'use strict';

const http = require('node:http');
const readline = require('node:readline');
const { readFileSync, existsSync, watchFile, unwatchFile } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// ── Configuration ────────────────────────────────────────────────────────────

const SESSION_FILE = join(tmpdir(), 'imcp-session.json');
const DEFAULT_PORT = 3100;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
const RETRY_BACKOFF = 2;
const HEALTH_POLL_MS = 5_000;

// ── Port resolution ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let port = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      if (isNaN(port)) port = null;
    }
  }
  return { port };
}

function readSessionFile() {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      return data.port || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolvePort() {
  const { port: cliPort } = parseArgs();
  if (cliPort) return cliPort;

  const envPort = process.env.IMCP_PORT
    ? parseInt(process.env.IMCP_PORT, 10)
    : null;
  if (envPort && !isNaN(envPort)) return envPort;

  const filePort = readSessionFile();
  if (filePort) return filePort;

  return DEFAULT_PORT;
}

// ── Stdio transport (OpenCode ↔ bridge) ──────────────────────────────────────

function writeStdout(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function writeResult(id, result) {
  writeStdout({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message) {
  writeStdout({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── HTTP transport (bridge ↔ desktop app) ────────────────────────────────────

let _port = resolvePort();
let _sessionId = null;
let _sseAbort = null;
let _retryCount = 0;

/**
 * Send a JSON-RPC request to the desktop app's /mcp endpoint.
 * Returns the parsed response body (or throws on network/protocol error).
 */
function httpPost(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (_sessionId) {
      headers['Mcp-Session-Id'] = _sessionId;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: _port,
        path: '/mcp',
        method: 'POST',
        headers,
      },
      (res) => {
        // Capture the session ID from the response
        const newSessionId = res.headers['mcp-session-id'];
        if (newSessionId) {
          _sessionId = newSessionId;
        }

        // Handle SSE responses (server may respond with text/event-stream)
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('text/event-stream')) {
          // SSE response — the result comes as events. Collect until done.
          let buffer = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk) => {
            buffer += chunk;
          });
          res.on('end', () => {
            // Parse SSE events to extract JSON-RPC result
            const parsed = parseSseEvents(buffer);
            if (parsed) {
              resolve(parsed);
            } else {
              resolve(null);
            }
          });
          res.on('error', reject);
          return;
        }

        // Standard JSON response
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          } else if (res.statusCode === 404) {
            // Session expired — clear session ID so next request re-initializes
            _sessionId = null;
            reject(new Error(`SESSION_EXPIRED:${data}`));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
        res.on('error', reject);
      },
    );

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Parse SSE event stream to extract JSON-RPC messages.
 * The Streamable HTTP Transport sends JSON-RPC responses as SSE events.
 */
function parseSseEvents(raw) {
  const events = raw.split(/\n\n/);
  for (const event of events) {
    const lines = event.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // try next
        }
      }
    }
  }
  return null;
}

// ── SSE long-poll for server notifications ────────────────────────────────────

function startSseListener() {
  if (_sseAbort) {
    _sseAbort.abort();
  }

  if (!_sessionId) return;

  const controller = new AbortController();
  _sseAbort = controller;

  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: _port,
      path: '/mcp',
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Mcp-Session-Id': _sessionId,
      },
      signal: controller.signal,
    },
    (res) => {
      if (res.statusCode !== 200) {
        // SSE not available or session expired; we'll retry on next request
        res.resume();
        return;
      }

      res.setEncoding('utf-8');
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk;

        // Process complete SSE events
        const parts = buffer.split('\n\n');
        // Last part may be incomplete
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const message = JSON.parse(line.slice(6));
                // Forward server notifications to OpenCode via stdout
                if (message && !Object.hasOwn(message, 'id')) {
                  writeStdout(message);
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      });

      res.on('end', () => {
        // SSE stream closed — server may have restarted
        _sseAbort = null;
        // Retry after a short delay
        setTimeout(() => startSseListener(), 2000);
      });

      res.on('error', () => {
        _sseAbort = null;
      });
    },
  );

  req.on('error', () => {
    _sseAbort = null;
    // Retry after a delay
    setTimeout(() => startSseListener(), 5000);
  });

  req.end();
}

// ── Retry logic ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay() {
  const delay = Math.min(
    RETRY_BASE_MS * Math.pow(RETRY_BACKOFF, _retryCount),
    RETRY_MAX_MS,
  );
  _retryCount++;
  return delay;
}

function resetRetry() {
  _retryCount = 0;
}

/**
 * Send a request with retry on ECONNREFUSED / network errors.
 * Will retry indefinitely until the desktop app comes back.
 */
async function httpPostWithRetry(body) {
  while (true) {
    try {
      // Re-check port from session file on each retry
      if (_retryCount > 0) {
        const freshPort = readSessionFile();
        if (freshPort) _port = freshPort;
      }

      const result = await httpPost(body);
      resetRetry();
      return result;
    } catch (err) {
      const errMsg = err.message || '';

      // Session expired — re-initialize and retry the original request
      if (errMsg.startsWith('SESSION_EXPIRED:')) {
        _sessionId = null;
        process.stderr.write(
          `[bridge] session expired, will re-initialize on next request\n`,
        );
        resetRetry();
        // Fall through to retry, which will trigger a new initialize
        continue;
      }

      // Connection refused or network error — retry with backoff
      const isNetworkError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.code === 'ETIMEDOUT' ||
        errMsg.includes('ECONNREFUSED');

      if (isNetworkError) {
        const delay = getRetryDelay();
        process.stderr.write(
          `[bridge] desktop app unreachable (${err.code || 'network error'}), retrying in ${delay}ms...\n`,
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error
      throw err;
    }
  }
}

// ── Request handler ──────────────────────────────────────────────────────────

/**
 * Handle an MCP initialize request. We need to forward it to the desktop app
 * and capture the session ID.
 */
async function handleInitialize(message) {
  _sessionId = null; // Clear any stale session

  try {
    const response = await httpPostWithRetry(message);

    if (response) {
      // Forward the initialize response to OpenCode
      writeStdout(response);

      // Start SSE listener for server notifications
      startSseListener();
    }
  } catch (err) {
    writeError(
      message.id,
      -32603,
      `Bridge failed to connect to desktop app: ${err.message}`,
    );
  }
}

/**
 * Handle a regular MCP request (tool call, etc.).
 * If we don't have a session yet, we need to initialize first.
 */
async function handleRequest(message) {
  // If we don't have a session, we need to initialize first
  // This shouldn't normally happen because OpenCode sends initialize first,
  // but handle it gracefully
  if (!_sessionId && message.method !== 'initialize') {
    process.stderr.write(
      `[bridge] no active session, request will trigger transparent reinit on server\n`,
    );
  }

  try {
    const response = await httpPostWithRetry(message);

    if (response) {
      writeStdout(response);

      // If we just got a new session ID (from transparent reinit), start SSE
      if (_sessionId && !_sseAbort) {
        startSseListener();
      }
    }
  } catch (err) {
    writeError(message.id, -32603, `Bridge request failed: ${err.message}`);
  }
}

/**
 * Handle a notification (no id field — fire-and-forget).
 */
async function handleNotification(message) {
  if (message.method === 'exit') {
    cleanup();
    process.exit(0);
    return;
  }

  if (message.method === 'notifications/cancelled') {
    // Forward cancellation to the desktop app
    try {
      await httpPost(message);
    } catch {
      // best effort
    }
    return;
  }

  // Forward all other notifications to the desktop app
  try {
    await httpPost(message);
  } catch {
    // best effort for notifications
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function cleanup() {
  if (_sseAbort) {
    _sseAbort.abort();
    _sseAbort = null;
  }
  unwatchFile(SESSION_FILE);
}

// Watch the session file for port changes (desktop app restarts with new port)
try {
  watchFile(SESSION_FILE, { interval: 5000 }, () => {
    const newPort = readSessionFile();
    if (newPort && newPort !== _port) {
      process.stderr.write(
        `[bridge] desktop app port changed: ${_port} -> ${newPort}\n`,
      );
      _port = newPort;
      _sessionId = null; // Force re-initialize on next request
      if (_sseAbort) {
        _sseAbort.abort();
        _sseAbort = null;
      }
    }
  });
} catch {
  // watchFile may fail on some systems; non-critical
}

// Periodically check if the desktop app is reachable (for status logging)
let _lastHealthy = false;
setInterval(() => {
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: _port,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (!_lastHealthy) {
          process.stderr.write(
            `[bridge] desktop app is reachable at port ${_port}\n`,
          );
          _lastHealthy = true;
        }
      });
    },
  );
  req.on('error', () => {
    if (_lastHealthy) {
      process.stderr.write(
        `[bridge] desktop app is unreachable at port ${_port}\n`,
      );
      _lastHealthy = false;
    }
  });
  req.on('timeout', () => {
    req.destroy();
    if (_lastHealthy) {
      process.stderr.write(
        `[bridge] desktop app health check timed out at port ${_port}\n`,
      );
      _lastHealthy = false;
    }
  });
  req.end();
}, HEALTH_POLL_MS);

// ── Main ─────────────────────────────────────────────────────────────────────

process.stderr.write(
  `[bridge] Interactive MCP Desktop Bridge started (port: ${_port})\n`,
);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!message || typeof message !== 'object') return;

  // Requests have an id field
  if (Object.hasOwn(message, 'id')) {
    if (message.method === 'initialize') {
      handleInitialize(message).catch((err) => {
        process.stderr.write(`[bridge] initialize error: ${err.message}\n`);
      });
    } else {
      handleRequest(message).catch((err) => {
        process.stderr.write(`[bridge] request error: ${err.message}\n`);
      });
    }
  } else {
    // Notifications (no id)
    handleNotification(message).catch((err) => {
      process.stderr.write(`[bridge] notification error: ${err.message}\n`);
    });
  }
});

rl.on('close', () => {
  cleanup();
  process.exit(0);
});

rl.on('error', (err) => {
  process.stderr.write(`[bridge] readline error: ${err.message}\n`);
});

// Handle SIGINT/SIGTERM
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
