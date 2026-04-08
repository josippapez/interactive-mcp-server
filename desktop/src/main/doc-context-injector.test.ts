import {
  beforeEach,
  describe,
  expect,
  it,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('./doc-indexer', () => ({
  warmUp: vi.fn(),
  isReady: vi.fn(() => false),
  findSemantic: vi.fn(),
  buildFullCache: vi.fn().mockResolvedValue(undefined),
  extractTitle: vi.fn(() => 'Doc Title'),
  DOC_MAX_FILE_SIZE: 1024 * 1024,
  SEMANTIC_THRESHOLD: 0.5,
  SEMANTIC_WEIGHT: 10,
}));

vi.mock('./opencode-injector', () => ({
  injectOpenCodeMessage: vi.fn(),
}));

import { initDocContext } from './doc-context-injector';
import { injectOpenCodeMessage } from './opencode-injector';

const mockInjectOpenCodeMessage = injectOpenCodeMessage as Mock;
const TEST_REPO = join(tmpdir(), `imcp-doc-context-test-${process.pid}`);

describe('initDocContext', () => {
  beforeEach(() => {
    mockInjectOpenCodeMessage.mockReset();
    rmSync(TEST_REPO, { recursive: true, force: true });
    mkdirSync(join(TEST_REPO, 'docs'), { recursive: true });
    writeFileSync(
      join(TEST_REPO, 'docs', 'ARCHITECTURE.md'),
      '# Architecture\n\nTest documentation.\n',
    );
  });

  afterEach(() => {
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  it('injects the manifest as context-only with noReply enabled', async () => {
    mockInjectOpenCodeMessage.mockResolvedValue({ ok: true, noReply: true });

    await initDocContext(TEST_REPO, 'ses_123', 4096);

    expect(mockInjectOpenCodeMessage).toHaveBeenCalledWith(
      'ses_123',
      expect.stringContaining(
        `Repository documentation index for ${TEST_REPO}:`,
      ),
      undefined,
      4096,
    );
  });
});
