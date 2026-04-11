import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  startAutoRegisterWithOpenCode,
  type RegisterWithOpenCode,
} from './auto-register';

describe('opencode-auto-register', () => {
  let register: Mock<RegisterWithOpenCode>;

  beforeEach(() => {
    vi.useFakeTimers();
    register = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one registration attempt immediately when started', async () => {
    register.mockResolvedValue({ status: 'registered' });

    startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
      },
      register,
    );

    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      appPort: 3100,
      openCodePort: 4096,
      promptTimeoutSeconds: undefined,
    });
  });

  it('passes promptTimeoutSeconds when getPromptTimeoutSeconds is provided', async () => {
    register.mockResolvedValue({ status: 'registered' });

    startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
        getPromptTimeoutSeconds: () => 1201,
      },
      register,
    );

    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      appPort: 3100,
      openCodePort: 4096,
      promptTimeoutSeconds: 1201,
    });
  });

  it('keeps attempting on interval while running', async () => {
    register.mockResolvedValue({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });

    startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
        intervalMs: 10_000,
      },
      register,
    );

    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(register).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(register).toHaveBeenCalledTimes(4);
  });

  it('does not overlap attempts when previous call is still in-flight', async () => {
    let resolveCurrent: (() => void) | undefined;
    register.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCurrent = () => resolve({ status: 'registered' });
        }),
    );

    startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
        intervalMs: 1_000,
      },
      register,
    );

    await vi.runOnlyPendingTimersAsync();
    expect(register).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(register).toHaveBeenCalledTimes(1);

    resolveCurrent?.();
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('stops scheduling attempts when stopped', async () => {
    register.mockResolvedValue({ status: 'registered' });

    const stop = startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
        intervalMs: 5_000,
      },
      register,
    );

    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);

    stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('skips attempts when shouldAttempt returns false', async () => {
    register.mockResolvedValue({ status: 'registered' });

    startAutoRegisterWithOpenCode(
      {
        getAppPort: () => 3100,
        getOpenCodePort: () => 4096,
        intervalMs: 5_000,
        shouldAttempt: () => false,
      },
      register,
    );

    expect(register).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(register).toHaveBeenCalledTimes(0);
  });
});
