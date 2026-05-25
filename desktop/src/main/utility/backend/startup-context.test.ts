import { describe, expect, it } from 'vitest';

import type { SkillOrInstruction } from './database';
import {
  buildSkillsChangedReminder,
  buildStartupContextMessage,
} from './startup-context';

function makeEntry(
  overrides: Partial<SkillOrInstruction> = {},
): SkillOrInstruction {
  return {
    id: 1,
    name: 'entry-name',
    type: 'skill',
    description: 'entry description',
    content: 'entry content',
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    folderId: null,
    scope: 'global',
    ...overrides,
  };
}

describe('buildStartupContextMessage', () => {
  it('uses catalog delivery for skills and inline delivery for always-mode instructions', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      entries: [
        makeEntry({ name: 'enabled-skill', type: 'skill', enabled: true }),
        makeEntry({
          id: 2,
          name: 'disabled-skill',
          type: 'skill',
          enabled: false,
        }),
        makeEntry({
          id: 3,
          name: 'enabled-instruction',
          type: 'instruction',
          deliveryMode: 'always',
          content: 'always follow this',
        }),
      ],
    });

    expect(message).toContain('<available_skills source="db">');
    expect(message).toContain('<name>enabled-skill</name>');
    expect(message).not.toContain('<content>entry content</content>');
    expect(message).toContain('<instructions source="db">');
    expect(message).toContain('<name>enabled-instruction</name>');
    expect(message).toContain('always follow this');
    expect(message).not.toContain('disabled-skill');
  });

  it('omits operational session metadata from the injected context', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      baseDirectory: '/tmp/project',
      openCodeSessionId: 'ses_abc123',
      entries: [],
    });

    expect(message).toBe('<system-reminder>\n</system-reminder>');
    expect(message).not.toContain('Interactive MCP Desktop session bootstrap');
    expect(message).not.toContain('Registered agent');
    expect(message).not.toContain('Test Agent');
    expect(message).not.toContain('Project');
    expect(message).not.toContain('interactive-mcp-server');
    expect(message).not.toContain('Base directory');
    expect(message).not.toContain('/tmp/project');
    expect(message).not.toContain('OpenCode session ID');
    expect(message).not.toContain('ses_abc123');
    expect(message).not.toContain('openCodeSessionId');
    expect(message).not.toContain('auto-registered');
    expect(message).not.toContain('Exposed MCP tools');
    expect(message).not.toContain('built-in questions tool');
    expect(message).not.toContain('register_connection');
    expect(message).not.toContain('request_user_input');
    expect(message).not.toContain('interactive prompt tools');
  });

  it('uses catalog delivery for catalog-mode instructions in startup context', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      entries: [
        makeEntry({
          name: 'catalog-instruction',
          type: 'instruction',
          deliveryMode: 'catalog',
          content: 'fetch me on demand',
        }),
      ],
    });

    expect(message).toContain('<available_instructions source="db">');
    expect(message).toContain('<name>catalog-instruction</name>');
    expect(message).toContain('<source>db</source>');
    expect(message).not.toContain('<instructions source="db">');
    expect(message).not.toContain('fetch me on demand');
    expect(message).toContain(
      'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any catalog instruction by name.',
    );
  });

  it('includes session-scoped entries only when opted into the session', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      entries: [
        makeEntry({ name: 'global-skill', type: 'skill', scope: 'global' }),
        makeEntry({
          id: 2,
          name: 'opted-in-skill',
          type: 'skill',
          scope: 'session-scoped',
        }),
        makeEntry({
          id: 3,
          name: 'not-opted-in-instruction',
          type: 'instruction',
          scope: 'session-scoped',
          content: 'only by opt-in',
        }),
      ],
      sessionOptInNames: ['opted-in-skill'],
    });

    expect(message).toContain('<name>global-skill</name>');
    expect(message).toContain('<name>opted-in-skill</name>');
    expect(message).not.toContain('not-opted-in-instruction');
  });

  it('excludes session-muted global entries', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      entries: [
        makeEntry({ name: 'visible-global', type: 'skill', scope: 'global' }),
        makeEntry({
          id: 2,
          name: 'muted-global',
          type: 'instruction',
          scope: 'global',
          content: 'should not appear',
        }),
      ],
      sessionMutedNames: ['muted-global'],
    });

    expect(message).toContain('<name>visible-global</name>');
    expect(message).not.toContain('muted-global');
  });

  it('escapes XML-like instruction content so closing tags cannot break the structure', () => {
    const message = buildStartupContextMessage({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      entries: [
        makeEntry({
          name: 'unsafe-instruction',
          type: 'instruction',
          deliveryMode: 'always',
          content: 'before </content> </instruction> </instructions> after',
        }),
      ],
    });

    expect(message).toContain('&lt;/content&gt;');
    expect(message).toContain('&lt;/instruction&gt;');
    expect(message).toContain('&lt;/instructions&gt;');
    expect(message.match(/<\/instructions>/g)).toHaveLength(1);
  });
});

describe('buildSkillsChangedReminder', () => {
  it('escapes XML-like names so reminder structure stays intact', () => {
    const reminder = buildSkillsChangedReminder({
      action: 'updated',
      type: 'skill',
      name: 'danger </system-reminder> name',
    });

    expect(reminder).toContain('&lt;/system-reminder&gt;');
    expect(reminder.match(/<\/system-reminder>/g)).toHaveLength(1);
  });

  it('tells live sessions to fetch updated catalog instructions on demand', () => {
    const reminder = buildSkillsChangedReminder({
      action: 'updated',
      type: 'instruction',
      name: 'catalog-instruction',
      deliveryMode: 'catalog',
    });

    expect(reminder).toContain(
      'Use action "get" with the instruction name to fetch its full content on demand.',
    );
    expect(reminder).not.toContain('re-injected on the next session bootstrap');
  });

  it('keeps minimal live-update wording for always instructions', () => {
    const reminder = buildSkillsChangedReminder({
      action: 'updated',
      type: 'instruction',
      name: 'always-instruction',
      deliveryMode: 'always',
    });

    expect(reminder).toContain(
      'Updated always-mode instruction content will be applied to new bootstrap injections. Active sessions should refresh their reminder context if needed.',
    );
  });
});
