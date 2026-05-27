'use strict';

function parseJsonResponseBody(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildOpenCodeAuthHeader(env = process.env) {
  const password = env.OPENCODE_SERVER_PASSWORD;
  if (!password) return null;
  const username = env.OPENCODE_SERVER_USERNAME || 'opencode';
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString(
    'base64',
  )}`;
}

async function openCodeRequest(context, method, apiPath, body) {
  const url = new URL(apiPath, context.openCodeServerUrl);
  url.searchParams.set('directory', context.root);
  const headers = new Headers();
  const authHeader = buildOpenCodeAuthHeader();
  if (authHeader) headers.set('Authorization', authHeader);
  if (body != null) headers.set('content-type', 'application/json');
  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = parseJsonResponseBody(text);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? data.message
        : text || response.statusText;
    throw new Error(`OpenCode ${method} ${apiPath} failed: ${message}`);
  }
  return data;
}

module.exports = { buildOpenCodeAuthHeader, openCodeRequest };
