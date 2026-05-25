import { describe, expect, it } from 'vitest';
import {
  buildPromptNotificationClickPayload,
  getPermissionNotificationText,
  getQuestionNotificationText,
  shouldRequestNotificationPermission,
  shouldNotifyForPermissionRequest,
  shouldShowNotificationSettingsPrompt,
} from './permission-notification';

describe('getPermissionNotificationText', () => {
  it('uses bash permission description as the notification body', () => {
    expect(
      getPermissionNotificationText({
        permission: 'bash',
        metadata: { description: 'Run tests' },
      }),
    ).toEqual({
      title: 'Permission requested',
      body: 'Run tests',
    });
  });

  it('summarizes file read permissions with the basename', () => {
    expect(
      getPermissionNotificationText({
        permission: 'read',
        patterns: ['/Users/me/project/src/app.ts'],
      }).body,
    ).toBe('Allow reading app.ts?');
  });

  it('falls back to the raw permission name', () => {
    expect(getPermissionNotificationText({ permission: 'webfetch' }).body).toBe(
      'Allow webfetch?',
    );
  });
});

describe('getQuestionNotificationText', () => {
  it('uses a single question as the notification body', () => {
    expect(
      getQuestionNotificationText({
        questions: [
          {
            question: 'Which option should I use?',
            header: 'Choose Path',
          },
        ],
      }),
    ).toEqual({
      title: 'Question requested',
      body: 'Which option should I use?',
    });
  });

  it('summarizes multiple questions', () => {
    expect(
      getQuestionNotificationText({
        questions: [
          { question: 'First?', header: 'One' },
          { question: 'Second?', header: 'Two' },
        ],
      }).body,
    ).toBe('2 questions need your input');
  });

  it('falls back when question text is unavailable', () => {
    expect(getQuestionNotificationText({ questions: [] }).body).toBe(
      'An agent needs your input',
    );
  });
});

describe('shouldNotifyForPermissionRequest', () => {
  it('notifies when the app window is visible and focused', () => {
    expect(
      shouldNotifyForPermissionRequest({
        isVisible: () => true,
        isFocused: () => true,
      }),
    ).toBe(true);
  });

  it('notifies when the app window is visible but unfocused', () => {
    expect(
      shouldNotifyForPermissionRequest({
        isVisible: () => true,
        isFocused: () => false,
      }),
    ).toBe(true);
  });

  it('notifies when the app window is hidden', () => {
    expect(
      shouldNotifyForPermissionRequest({
        isVisible: () => false,
        isFocused: () => false,
      }),
    ).toBe(true);
  });
});

describe('shouldRequestNotificationPermission', () => {
  it('requests permission on macOS when permission is undecided', () => {
    expect(shouldRequestNotificationPermission('darwin', 'default')).toBe(true);
  });

  it('does not request permission when macOS already granted it', () => {
    expect(shouldRequestNotificationPermission('darwin', 'granted')).toBe(
      false,
    );
  });

  it('does not request permission on other platforms', () => {
    expect(shouldRequestNotificationPermission('win32', 'default')).toBe(false);
  });
});

describe('shouldShowNotificationSettingsPrompt', () => {
  it('shows settings guidance once when macOS notifications are denied', () => {
    expect(
      shouldShowNotificationSettingsPrompt('darwin', 'denied', false),
    ).toBe(true);
  });

  it('does not repeatedly show settings guidance', () => {
    expect(shouldShowNotificationSettingsPrompt('darwin', 'denied', true)).toBe(
      false,
    );
  });

  it('does not show settings guidance when notifications are granted', () => {
    expect(
      shouldShowNotificationSettingsPrompt('darwin', 'granted', false),
    ).toBe(false);
  });
});

describe('buildPromptNotificationClickPayload', () => {
  it('targets the prompt session when a provider session id is available', () => {
    expect(buildPromptNotificationClickPayload('ses_123')).toEqual({
      providerSessionId: 'ses_123',
    });
  });

  it('does not emit a click payload when no provider session id is available', () => {
    expect(buildPromptNotificationClickPayload(null)).toBeNull();
  });
});
