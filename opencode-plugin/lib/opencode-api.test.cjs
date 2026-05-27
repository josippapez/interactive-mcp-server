'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildOpenCodeAuthHeader } = require('./opencode-api.cjs');

test('buildOpenCodeAuthHeader returns null without a password', () => {
  assert.equal(buildOpenCodeAuthHeader({}), null);
});

test('buildOpenCodeAuthHeader uses default OpenCode username', () => {
  assert.equal(
    buildOpenCodeAuthHeader({ OPENCODE_SERVER_PASSWORD: 'secret' }),
    `Basic ${Buffer.from('opencode:secret', 'utf8').toString('base64')}`,
  );
});

test('buildOpenCodeAuthHeader uses configured OpenCode username', () => {
  assert.equal(
    buildOpenCodeAuthHeader({
      OPENCODE_SERVER_PASSWORD: 'secret',
      OPENCODE_SERVER_USERNAME: 'custom',
    }),
    `Basic ${Buffer.from('custom:secret', 'utf8').toString('base64')}`,
  );
});
