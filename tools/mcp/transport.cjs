function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

module.exports = { writeMessage, writeResult, writeError };
