const { SERVER_INFO, SUPPORTED_PROTOCOL_VERSION } = require('./config.cjs');
const { writeResult, writeError } = require('./transport.cjs');
const {
  docsTool,
  readDocTool,
  listDocsTool,
  findDocs,
  readDoc,
  listDocs,
} = require('./tools/docs.cjs');
const { libsTool, findLibs } = require('./tools/libs.cjs');
const { warmUp } = require('./semantic-index.cjs');

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
    warmUp();
    return;
  }

  if (method === 'shutdown') {
    writeResult(id, null);
    return;
  }

  if (method === 'tools/list') {
    writeResult(id, {
      tools: [docsTool, listDocsTool, libsTool, readDocTool],
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'find_docs') {
      writeResult(id, {
        content: [{ type: 'text', text: await findDocs(args) }],
      });
      return;
    }

    if (toolName === 'find_libs') {
      writeResult(id, {
        content: [{ type: 'text', text: findLibs(args) }],
      });
      return;
    }

    if (toolName === 'read_doc') {
      writeResult(id, {
        content: [{ type: 'text', text: readDoc(args) }],
      });
      return;
    }

    if (toolName === 'list_docs') {
      writeResult(id, {
        content: [{ type: 'text', text: listDocs(args) }],
      });
      return;
    }

    writeError(id, -32602, `Unknown tool: ${String(toolName)}`);
    return;
  }

  if (method === 'ping') {
    writeResult(id, {});
    return;
  }

  writeError(id, -32601, `Method not found: ${method}`);
}

function handleNotification(message) {
  if (message.method === 'exit') {
    process.exit(0);
  }
}

module.exports = { handleRequest, handleNotification };
