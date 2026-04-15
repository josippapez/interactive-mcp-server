export const DEFAULT_OPENCODE_PORT = 4096;

const PORT_MIN = 1;
const PORT_MAX = 65535;

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= PORT_MIN && value <= PORT_MAX;
}

export function buildOpenCodePortCandidates(
  primaryPort: number,
  additionalPorts: number[] = [],
): number[] {
  const ports = [primaryPort, DEFAULT_OPENCODE_PORT, ...additionalPorts].filter(
    isValidPort,
  );
  return Array.from(new Set(ports));
}

export async function resolveReachableOpenCodePorts(
  primaryPort: number,
  additionalPorts: number[] = [],
  timeoutMs = 1200,
): Promise<number[]> {
  const candidates = buildOpenCodePortCandidates(primaryPort, additionalPorts);

  const checks = await Promise.all(
    candidates.map(async (port) => {
      try {
        const res = await fetch(`http://localhost:${port}/global/health`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok ? port : null;
      } catch {
        return null;
      }
    }),
  );

  return checks.filter((port): port is number => port !== null);
}

export async function fetchFirstSuccessfulJson<T>(
  ports: number[],
  path: string,
  timeoutMs = 3000,
): Promise<{ port: number; data: T } | null> {
  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as T;
      return { port, data };
    } catch {
      // failure isolation: try next port
    }
  }

  return null;
}

export async function fetchJsonFromAllReachable<T>(
  ports: number[],
  path: string,
  timeoutMs = 3000,
): Promise<Array<{ port: number; data: T }>> {
  const results = await Promise.all(
    ports.map(async (port) => {
      try {
        const res = await fetch(`http://localhost:${port}${path}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as T;
        return { port, data };
      } catch {
        return null;
      }
    }),
  );

  return results.filter(
    (item): item is { port: number; data: T } => item !== null,
  );
}
