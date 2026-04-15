import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { existsSync, readFileSync } from 'fs';
import {
  injectProjectMcps,
  recordInjectedMcps,
  getInjectedMcps,
  clearInjectedMcps,
  getAllInjectedMcpSessions,
  _resetTrackingForTest,
  type McpInjectionOptions,
} from './mcp-inject';

// ─── Mock fs ──────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

// ─── Mock logger ──────────────────────────────────────────────────────────────

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('mcp-inject', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetTrackingForTest();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ─── Config Parsing ───────────────────────────────────────────────────────

  describe('config parsing', () => {
    it('returns configFound: false when config file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.injectedMcps).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('parses JSONC with single-line comments', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        // This is a comment
        "mcp": {
          "test-mcp": {
            "type": "remote",
            "url": "http://localhost:3000/mcp"
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('injected');
    });

    it('parses JSONC with block comments', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        /* This is a block comment */
        "mcp": {
          "test-mcp": {
            "type": "remote",
            "url": "http://localhost:3000/mcp"
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(true);
      expect(result.results).toHaveLength(1);
    });

    it('returns parseError when config is invalid JSON', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(true);
      expect(result.parseError).toContain('parse-error');
      expect(result.results).toHaveLength(0);
    });

    it('handles empty mcp section gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ "mcp": {} }');

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles missing mcp section gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ "someOtherConfig": true }');

      const result = await injectProjectMcps({
        baseDirectory: '/projects/my-app',
        openCodePort: 4096,
        logger: mockLogger,
      });

      expect(result.configFound).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  // ─── MCP Registration ─────────────────────────────────────────────────────

  describe('MCP registration', () => {
    const baseOptions: McpInjectionOptions = {
      baseDirectory: '/projects/my-app',
      openCodePort: 4096,
      logger: mockLogger,
    };

    it('registers a remote MCP server via POST /mcp', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "figma": {
            "type": "remote",
            "url": "http://127.0.0.1:3845/mcp"
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4096/mcp',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'figma',
            config: {
              type: 'remote',
              url: 'http://127.0.0.1:3845/mcp',
            },
          }),
        }),
      );
      expect(result.injectedMcps).toEqual(['figma']);
    });

    it('registers a local MCP server with command', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "ado": {
            "type": "local",
            "command": ["npx", "-y", "@azure-devops/mcp"],
            "environment": {
              "ADO_ORG": "my-org",
              "ADO_PAT": "secret-token"
            }
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4096/mcp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'ado',
            config: {
              type: 'local',
              command: ['npx', '-y', '@azure-devops/mcp'],
              environment: {
                ADO_ORG: 'my-org',
                ADO_PAT: 'secret-token',
              },
            },
          }),
        }),
      );
      expect(result.injectedMcps).toEqual(['ado']);
    });

    it('registers multiple MCPs in sequence', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "figma": { "type": "remote", "url": "http://localhost:3845/mcp" },
          "ado": { "type": "local", "command": ["npx", "ado-mcp"] },
          "chrome": { "type": "remote", "url": "http://localhost:9222/mcp" }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.injectedMcps).toEqual(['figma', 'ado', 'chrome']);
    });

    it('skips disabled MCPs', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "enabled-mcp": { "type": "remote", "url": "http://localhost:3000/mcp" },
          "disabled-mcp": { "type": "remote", "url": "http://localhost:3001/mcp", "enabled": false }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('injected');
      expect(result.results[1].status).toBe('skipped');
      expect(result.injectedMcps).toEqual(['enabled-mcp']);
    });

    it('includes timeout in config when specified', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "slow-mcp": {
            "type": "remote",
            "url": "http://localhost:3000/mcp",
            "timeout": 120000
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      await injectProjectMcps(baseOptions);

      const body = JSON.parse(
        mockFetch.mock.calls[0][1].body as string,
      ) as Record<string, unknown>;
      expect((body.config as Record<string, unknown>).timeout).toBe(120000);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    const baseOptions: McpInjectionOptions = {
      baseDirectory: '/projects/my-app',
      openCodePort: 4096,
      logger: mockLogger,
    };

    it('handles OpenCode API returning non-ok status', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "test-mcp": { "type": "remote", "url": "http://localhost:3000/mcp" }
        }
      }`);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const result = await injectProjectMcps(baseOptions);

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].error).toContain('500');
      expect(result.injectedMcps).toHaveLength(0);
    });

    it('handles network errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "test-mcp": { "type": "remote", "url": "http://localhost:3000/mcp" }
        }
      }`);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await injectProjectMcps(baseOptions);

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].error).toContain('ECONNREFUSED');
      expect(result.injectedMcps).toHaveLength(0);
    });

    it('continues with other MCPs when one fails', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "good-mcp": { "type": "remote", "url": "http://localhost:3000/mcp" },
          "bad-mcp": { "type": "remote", "url": "http://localhost:3001/mcp" },
          "another-good": { "type": "remote", "url": "http://localhost:3002/mcp" }
        }
      }`);
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(result.results).toHaveLength(3);
      expect(result.results[0].status).toBe('injected');
      expect(result.results[1].status).toBe('error');
      expect(result.results[2].status).toBe('injected');
      expect(result.injectedMcps).toEqual(['good-mcp', 'another-good']);
    });

    it('handles read errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await injectProjectMcps(baseOptions);

      expect(result.configFound).toBe(true);
      expect(result.parseError).toContain('read-error');
      expect(result.results).toHaveLength(0);
    });
  });

  // ─── Tracking Functions ───────────────────────────────────────────────────

  describe('tracking functions', () => {
    it('records and retrieves injected MCPs for a session', () => {
      recordInjectedMcps('ses_abc', ['figma', 'ado']);

      expect(getInjectedMcps('ses_abc')).toEqual(['figma', 'ado']);
    });

    it('returns empty array for unknown session', () => {
      expect(getInjectedMcps('ses_unknown')).toEqual([]);
    });

    it('merges MCPs when recording multiple times', () => {
      recordInjectedMcps('ses_abc', ['figma']);
      recordInjectedMcps('ses_abc', ['ado', 'figma']); // figma is duplicate

      expect(getInjectedMcps('ses_abc')).toEqual(['figma', 'ado']);
    });

    it('ignores empty MCP arrays', () => {
      recordInjectedMcps('ses_abc', []);

      expect(getInjectedMcps('ses_abc')).toEqual([]);
    });

    it('clears injected MCPs for a session', () => {
      recordInjectedMcps('ses_abc', ['figma', 'ado']);
      clearInjectedMcps('ses_abc');

      expect(getInjectedMcps('ses_abc')).toEqual([]);
    });

    it('returns all sessions with injected MCPs', () => {
      recordInjectedMcps('ses_abc', ['figma']);
      recordInjectedMcps('ses_def', ['ado', 'chrome']);

      const all = getAllInjectedMcpSessions();

      expect(all.size).toBe(2);
      expect(all.get('ses_abc')).toEqual(['figma']);
      expect(all.get('ses_def')).toEqual(['ado', 'chrome']);
    });
  });

  // ─── Real-World Config Examples ───────────────────────────────────────────

  describe('real-world config examples', () => {
    const baseOptions: McpInjectionOptions = {
      baseDirectory: '/Volumes/encrypted/Sciensus.Digital.Core.NX',
      openCodePort: 4096,
      logger: mockLogger,
    };

    it('handles the Sciensus project config example', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`{
        "mcp": {
          "ado": {
            "type": "local",
            "command": ["npx", "-y", "@azure-devops/mcp"],
            "environment": {
              "ADO_ORG": "sciensus",
              "ADO_PAT": "my-token"
            }
          },
          "figma": {
            "url": "http://127.0.0.1:3845/mcp",
            "type": "remote"
          }
        }
      }`);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await injectProjectMcps(baseOptions);

      expect(result.configFound).toBe(true);
      expect(result.injectedMcps).toEqual(['ado', 'figma']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
