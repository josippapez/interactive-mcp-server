import { getClient } from './sdk-client';

export interface NativeOpenCodeSkill {
  name: string;
  description: string;
  location: string;
  content: string;
}

function isNativeOpenCodeSkill(value: unknown): value is NativeOpenCodeSkill {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    typeof item.location === 'string' &&
    typeof item.content === 'string'
  );
}

export async function listNativeOpenCodeSkills(
  openCodePort: number,
  baseDirectory?: string,
): Promise<NativeOpenCodeSkill[]> {
  try {
    const client = getClient(openCodePort, baseDirectory);
    const response = await client.app.skills(
      baseDirectory ? { directory: baseDirectory } : undefined,
      { signal: AbortSignal.timeout(5000) },
    );

    if (response.error || !Array.isArray(response.data)) {
      return [];
    }

    return response.data
      .filter(isNativeOpenCodeSkill)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
