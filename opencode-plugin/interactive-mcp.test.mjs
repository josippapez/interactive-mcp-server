import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin from './interactive-mcp.js';

function withOpenCodeEnv(env, fn) {
  const previousPassword = process.env.OPENCODE_SERVER_PASSWORD;
  const previousUsername = process.env.OPENCODE_SERVER_USERNAME;
  if (env.OPENCODE_SERVER_PASSWORD === undefined) {
    delete process.env.OPENCODE_SERVER_PASSWORD;
  } else {
    process.env.OPENCODE_SERVER_PASSWORD = env.OPENCODE_SERVER_PASSWORD;
  }
  if (env.OPENCODE_SERVER_USERNAME === undefined) {
    delete process.env.OPENCODE_SERVER_USERNAME;
  } else {
    process.env.OPENCODE_SERVER_USERNAME = env.OPENCODE_SERVER_USERNAME;
  }
  try {
    return fn();
  } finally {
    if (previousPassword === undefined) {
      delete process.env.OPENCODE_SERVER_PASSWORD;
    } else {
      process.env.OPENCODE_SERVER_PASSWORD = previousPassword;
    }
    if (previousUsername === undefined) {
      delete process.env.OPENCODE_SERVER_USERNAME;
    } else {
      process.env.OPENCODE_SERVER_USERNAME = previousUsername;
    }
  }
}

test('wires the bundled standalone MCP without replacing existing MCPs', async () => {
  const hooks = await withOpenCodeEnv(
    { OPENCODE_SERVER_PASSWORD: undefined, OPENCODE_SERVER_USERNAME: undefined },
    () =>
      plugin({
        directory: '/tmp/project',
        serverUrl: new URL('http://localhost:4321'),
        worktree: '/tmp/project-worktree',
      }),
  );
  const config = {
    mcp: {
      existing: { type: 'local', command: ['node', 'existing.cjs'] },
    },
  };

  await hooks.config(config);

  assert.deepEqual(config.mcp.existing, {
    type: 'local',
    command: ['node', 'existing.cjs'],
  });
  assert.equal(config.mcp['interactive-mcp-standalone'].type, 'local');
  assert.equal(config.mcp['interactive-mcp-standalone'].enabled, true);
  assert.equal(config.mcp['interactive-mcp-standalone'].timeout, 30000);
  assert.deepEqual(config.mcp['interactive-mcp-standalone'].environment, {});
  assert.equal(
    config.mcp['interactive-mcp-standalone'].command.at(-1),
    'http://localhost:4321/',
  );
  assert.equal(
    config.mcp['interactive-mcp-standalone'].command.at(-2),
    '/tmp/project-worktree',
  );
  assert.match(
    config.mcp['interactive-mcp-standalone'].command.at(-3),
    /standalone-mcp\.cjs$/,
  );
});

test('passes OpenCode server auth environment into the standalone MCP', async () => {
  const hooks = await withOpenCodeEnv(
    {
      OPENCODE_SERVER_PASSWORD: 'test-password',
      OPENCODE_SERVER_USERNAME: 'test-user',
    },
    () =>
      plugin({
        directory: '/tmp/project',
        serverUrl: new URL('http://localhost:4321'),
      }),
  );
  const config = {};

  await hooks.config(config);

  assert.deepEqual(config.mcp['interactive-mcp-standalone'].environment, {
    OPENCODE_SERVER_PASSWORD: 'test-password',
    OPENCODE_SERVER_USERNAME: 'test-user',
  });
});
