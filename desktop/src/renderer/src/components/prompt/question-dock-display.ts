export const CUSTOM_ANSWER_LABEL = 'Type your own answer';

export type QuestionDockLayout = {
  rootContainer: string;
  desktopContainer: string;
  mobileContainer: string;
  dockClassName: string;
};

export type QuestionDockCustomOptionState = {
  visible: boolean;
  picked: boolean;
  description: string;
};

export function getQuestionDockProgressLabel(
  currentIndex: number,
  total: number,
): string {
  return `${Math.min(currentIndex + 1, total)} of ${total} questions`;
}

export function getQuestionDockLayout(open: boolean): QuestionDockLayout {
  if (!open) {
    return {
      rootContainer: 'hidden',
      desktopContainer: 'hidden',
      mobileContainer: 'hidden',
      dockClassName: '',
    };
  }

  return {
    rootContainer:
      'pointer-events-none flex w-full shrink-0 flex-col items-center justify-center px-3 pt-2',
    desktopContainer:
      'pointer-events-auto w-full md:max-w-[800px] 2xl:max-w-[1000px]',
    mobileContainer: 'hidden',
    dockClassName: 'w-full',
  };
}

export function getQuestionDockCustomOptionState({
  customEnabled,
  customAnswer,
  editing,
}: {
  customEnabled: boolean;
  customAnswer: string;
  editing: boolean;
}): QuestionDockCustomOptionState {
  const trimmed = customAnswer.trim();

  return {
    visible: customEnabled,
    picked: editing || trimmed.length > 0,
    description: trimmed || CUSTOM_ANSWER_LABEL,
  };
}
