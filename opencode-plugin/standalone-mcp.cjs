#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { createContext } = require('./lib/context.cjs');
const { findDocsTool } = require('./tools/find-docs.cjs');
const { listDocsTool } = require('./tools/list-docs.cjs');
const { readDocTool } = require('./tools/read-doc.cjs');
const { findLibsTool } = require('./tools/find-libs.cjs');
const {
  repositoryIndexStatusTool,
} = require('./tools/get-repository-index-status.cjs');
const { fileDependenciesTool } = require('./tools/get-file-dependencies.cjs');
const { fileDependentsTool } = require('./tools/get-file-dependents.cjs');
const { blastRadiusTool } = require('./tools/get-blast-radius.cjs');
const {
  manageBackgroundSubagentsTool,
} = require('./tools/manage-background-subagents.cjs');
const {
  messageBackgroundSubagentTool,
} = require('./tools/message-background-subagent.cjs');
const { manageMemoriesTool } = require('./tools/manage-memories.cjs');

const SERVER_INFO = { name: 'interactive-mcp-standalone', version: '0.1.0' };
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const context = createContext(process.argv[2], process.argv[3]);
const registeredTools = [
  findDocsTool,
  listDocsTool,
  readDocTool,
  findLibsTool,
  repositoryIndexStatusTool,
  fileDependenciesTool,
  fileDependentsTool,
  blastRadiusTool,
  manageBackgroundSubagentsTool,
  messageBackgroundSubagentTool,
  manageMemoriesTool,
];

const toolsByName = new Map(
  registeredTools.map((tool) => [tool.definition.name, tool]),
);

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

async function handleToolCall(name, args) {
  const tool = toolsByName.get(String(name));
  if (!tool) throw new Error(`Unknown tool: ${String(name)}`);
  return tool.execute(args || {}, context);
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === 'shutdown') {
    writeResult(id, null);
    return;
  }
  if (method === 'tools/list') {
    writeResult(id, { tools: registeredTools.map((tool) => tool.definition) });
    return;
  }
  if (method === 'tools/call') {
    try {
      writeResult(
        id,
        textResult(await handleToolCall(params?.name, params?.arguments)),
      );
    } catch (err) {
      writeError(id, -32602, err.message);
    }
    return;
  }
  if (method === 'ping') {
    writeResult(id, {});
    return;
  }
  writeError(id, -32601, `Method not found: ${method}`);
}

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
  if (message && Object.hasOwn(message, 'id')) {
    Promise.resolve(handleRequest(message)).catch((err) =>
      process.stderr.write(`handler error: ${err.message}\n`),
    );
  } else if (message?.method === 'exit') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
rl.on('error', (err) =>
  process.stderr.write(`readline error: ${err.message}\n`),
);
