import { describe, expect, it } from 'vitest';
import { mapSdkAgent } from './agents';
import type { Agent as SdkAgent } from '@opencode-ai/sdk/v2/client';

function agent(name: string, overrides: Partial<SdkAgent> = {}): SdkAgent {
  return {
    name,
    description: `${name} from sdk`,
    mode: 'subagent',
    permission: [],
    options: {},
    ...overrides,
  };
}

describe('mapSdkAgent', () => {
  it('maps SDK agents as read-only opencode agents', () => {
    expect(
      mapSdkAgent(
        agent('oracle', {
          native: false,
          model: { providerID: 'github-copilot', modelID: 'gpt-5.5' },
          prompt: 'prompt body',
        }),
      ),
    ).toMatchObject({
      name: 'oracle',
      filePath: 'opencode-sdk:oracle',
      scope: 'global',
      model: 'github-copilot/gpt-5.5',
      body: 'prompt body',
      rawContents: '',
      editable: false,
      native: false,
    });
  });
});
