#!/usr/bin/env node

const readline = require('node:readline');
const { handleRequest, handleNotification } = require('./handlers.cjs');

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message && Object.hasOwn(message, 'id')) {
    Promise.resolve(handleRequest(message)).catch((err) => {
      process.stderr.write(`handler error: ${err.message}\n`);
    });
  } else if (message) {
    handleNotification(message);
  }
});

rl.on('close', () => {
  process.exit(0);
});

rl.on('error', (err) => {
  process.stderr.write(`readline error: ${err.message}\n`);
});
