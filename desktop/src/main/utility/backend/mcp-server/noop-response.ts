/**
 * Factory for a no-op response stub used for synthetic MCP handshake requests.
 * Must satisfy @hono/node-server's requirements (writeHead, removeHeader, etc.)
 * so StreamableHTTPServerTransport does not throw on synthetic requests.
 */
export function createNoopResponse() {
  const obj = {
    setHeader() {
      return obj;
    },
    getHeader() {
      return undefined;
    },
    getHeaders() {
      return {};
    },
    removeHeader() {},
    writeHead() {
      return obj;
    },
    flushHeaders() {},
    status() {
      return obj;
    },
    json() {},
    end() {
      return obj;
    },
    write() {
      return true;
    },
    destroy() {},
    on() {
      return obj;
    },
    once() {
      return obj;
    },
    off() {
      return obj;
    },
    emit() {
      return true;
    },
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
  };
  return obj;
}
