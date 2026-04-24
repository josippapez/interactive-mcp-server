const REGISTER_CONNECTION_TIMEOUT_MS = 15_000;
const REGISTER_CONNECTION_TIMEOUT_MESSAGE =
  'register_connection timed out after 15s';

function ensureRegisterConnectionTimeRemaining(startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  const remaining = REGISTER_CONNECTION_TIMEOUT_MS - elapsed;
  if (remaining <= 0) {
    throw new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE);
  }
  return remaining;
}

export async function withRegisterConnectionDeadline<T>(
  promise: Promise<T>,
  startedAt: number,
): Promise<T> {
  const remaining = ensureRegisterConnectionTimeRemaining(startedAt);

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE));
    }, remaining);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function isRegisterConnectionTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === REGISTER_CONNECTION_TIMEOUT_MESSAGE
  );
}

export { ensureRegisterConnectionTimeRemaining };
