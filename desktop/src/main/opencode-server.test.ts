import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startOpenCodeServer,
  stopOpenCodeServer,
  isOpenCodeServerRunning,
} from '../main/opencode-server';

// Mock child_process.spawn so we don't actually launch opencode
vi.mock('child_process', () => {
  const mockProcess = {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn(),
    kill: vi.fn(),
    exitCode: null as number | null,
  };

  return {
    spawn: vi.fn(() => mockProcess),
    __mockProcess: mockProcess,
  };
});

// Mock fs.existsSync for resolveOpenCodeBin
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      // Simulate opencode binary existing at the home path
      if (typeof path === 'string' && path.includes('.opencode/bin/opencode'))
        return true;
      return actual.existsSync(path);
    }),
  };
});

describe('opencode-server', () => {
  beforeEach(() => {
    // Ensure clean state
    stopOpenCodeServer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopOpenCodeServer();
  });

  it('isOpenCodeServerRunning returns false before start', () => {
    expect(isOpenCodeServerRunning()).toBe(false);
  });

  it('startOpenCodeServer spawns a child process', async () => {
    const { spawn } = await import('child_process');

    startOpenCodeServer(4096);

    expect(spawn).toHaveBeenCalledTimes(1);
    const args = vi.mocked(spawn).mock.calls[0];
    // First arg is the binary path
    expect(args[0]).toBeDefined();
    // Second arg is the arguments array
    expect(args[1]).toContain('serve');
    expect(args[1]).toContain('--port');
    expect(args[1]).toContain('4096');
  });

  it('isOpenCodeServerRunning returns true after start', () => {
    startOpenCodeServer(4096);
    expect(isOpenCodeServerRunning()).toBe(true);
  });

  it('stopOpenCodeServer kills the process', async () => {
    const cp = await import('child_process');
    const mockProcess = (
      cp as unknown as { __mockProcess: { kill: ReturnType<typeof vi.fn> } }
    ).__mockProcess;

    startOpenCodeServer(4096);
    stopOpenCodeServer();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(isOpenCodeServerRunning()).toBe(false);
  });

  it('is a no-op when already running on the same port', async () => {
    const { spawn } = await import('child_process');

    startOpenCodeServer(4096);
    startOpenCodeServer(4096); // second call — should be a no-op

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('restarts when the port changes', async () => {
    const { spawn } = await import('child_process');
    const cp = await import('child_process');
    const mockProcess = (
      cp as unknown as { __mockProcess: { kill: ReturnType<typeof vi.fn> } }
    ).__mockProcess;

    startOpenCodeServer(4096);
    startOpenCodeServer(5000); // different port

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(spawn).mock.calls[1];
    expect(secondCall[1]).toContain('5000');
  });
});
