import { describe, expect, it } from 'vitest';
import {
  getQuestionDockProgressLabel,
  getQuestionDockLayout,
  getQuestionDockCustomOptionState,
} from './question-dock-display';

describe('question dock display helpers', () => {
  it('matches the OpenCode progress summary format', () => {
    expect(getQuestionDockProgressLabel(0, 3)).toBe('1 of 3 questions');
    expect(getQuestionDockProgressLabel(2, 3)).toBe('3 of 3 questions');
  });

  it('uses composer-flow placement classes instead of floating over the composer', () => {
    expect(getQuestionDockLayout(true)).toEqual({
      rootContainer:
        'pointer-events-none flex w-full shrink-0 flex-col items-center justify-center px-3 pt-2',
      desktopContainer:
        'pointer-events-auto w-full md:max-w-[800px] 2xl:max-w-[1000px]',
      mobileContainer: 'hidden',
      dockClassName: 'w-full',
    });
    expect(getQuestionDockLayout(false)).toEqual({
      rootContainer: 'hidden',
      desktopContainer: 'hidden',
      mobileContainer: 'hidden',
      dockClassName: '',
    });
  });

  it('treats the custom answer as an option with a placeholder before editing', () => {
    expect(
      getQuestionDockCustomOptionState({
        customEnabled: true,
        customAnswer: '',
        editing: false,
      }),
    ).toEqual({
      visible: true,
      picked: false,
      description: 'Type your own answer',
    });
  });

  it('marks the custom option as picked when an answer is present', () => {
    expect(
      getQuestionDockCustomOptionState({
        customEnabled: true,
        customAnswer: 'Use the webview version',
        editing: false,
      }),
    ).toEqual({
      visible: true,
      picked: true,
      description: 'Use the webview version',
    });
  });
});
