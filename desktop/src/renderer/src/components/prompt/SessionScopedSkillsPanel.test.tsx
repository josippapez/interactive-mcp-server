import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillOrInstructionRecord } from '../../../../preload/api/types';
import { SessionScopedSkillsPanel } from './SessionScopedSkillsPanel';

function buildEntry(
  overrides: Partial<SkillOrInstructionRecord> = {},
): SkillOrInstructionRecord {
  return {
    id: 1,
    name: 'example',
    type: 'skill',
    description: 'desc',
    content: '',
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '',
    updatedAt: '',
    folderId: null,
    scope: 'global',
    ...overrides,
  };
}

type PanelProps = {
  providerType: string | null;
  providerSessionId: string | null;
};

function panel(props: PanelProps): React.ReactElement {
  return createElement(SessionScopedSkillsPanel, props);
}

describe('SessionScopedSkillsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('loads skills exactly once on mount', async () => {
    const listSkills = vi
      .spyOn(window.api, 'listSkillsAndInstructions')
      .mockResolvedValue([
        buildEntry({ id: 1, name: 'global-a', scope: 'global' }),
        buildEntry({ id: 2, name: 'session-b', scope: 'session-scoped' }),
      ]);

    render(panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }));

    await waitFor(() => {
      expect(listSkills).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT re-fire listSkillsAndInstructions on parent rerender with unchanged props', async () => {
    const listSkills = vi
      .spyOn(window.api, 'listSkillsAndInstructions')
      .mockResolvedValue([]);

    const { rerender } = render(
      panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }),
    );

    await waitFor(() => {
      expect(listSkills).toHaveBeenCalledTimes(1);
    });

    rerender(panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }));
    rerender(panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }));

    // Give any pending effects a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(listSkills).toHaveBeenCalledTimes(1);
  });

  it('re-fires listSkillsAndInstructions when providerSessionId changes', async () => {
    const listSkills = vi
      .spyOn(window.api, 'listSkillsAndInstructions')
      .mockResolvedValue([]);

    const { rerender } = render(
      panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }),
    );

    await waitFor(() => {
      expect(listSkills).toHaveBeenCalledTimes(1);
    });

    rerender(panel({ providerType: 'opencode', providerSessionId: 'ses_def' }));

    await waitFor(() => {
      expect(listSkills).toHaveBeenCalledTimes(2);
    });
  });

  it('invokes the onSkillsUpdated disposer on unmount', async () => {
    const disposer = vi.fn();
    const onSkillsUpdated = vi
      .spyOn(window.api, 'onSkillsUpdated')
      .mockReturnValue(disposer);

    const { unmount } = render(
      panel({ providerType: 'opencode', providerSessionId: 'ses_abc' }),
    );

    await waitFor(() => {
      expect(onSkillsUpdated).toHaveBeenCalledTimes(1);
    });
    expect(disposer).not.toHaveBeenCalled();

    unmount();

    expect(disposer).toHaveBeenCalledTimes(1);
  });

  it('makes zero IPC calls when providerType and providerSessionId are null', async () => {
    const listSkills = vi.spyOn(window.api, 'listSkillsAndInstructions');
    const listMuted = vi.spyOn(window.api, 'listSessionMutedEntries');
    const listScoped = vi.spyOn(window.api, 'listSessionScopedEntries');

    render(panel({ providerType: null, providerSessionId: null }));

    // Allow effects to run.
    await new Promise((r) => setTimeout(r, 20));

    expect(listSkills).not.toHaveBeenCalled();
    expect(listMuted).not.toHaveBeenCalled();
    expect(listScoped).not.toHaveBeenCalled();
  });
});
