import type { RefObject } from 'react';
import type { QueuedAttachment } from './constants.js';
import type { TextareaRenderableLike } from './types.js';
import { safeReadTextarea } from './textarea-operations.js';

export interface SubmitHandlerDeps {
  mode: 'option' | 'input';
  predefinedOptions: string[];
  selectedIndex: number;
  inputValue: string;
  queuedAttachments: QueuedAttachment[];
  textareaRef: RefObject<TextareaRenderableLike | null>;
  onSubmit: (questionId: string, answer: string) => void;
  questionId: string;
  setQueuedAttachments: React.Dispatch<
    React.SetStateAction<QueuedAttachment[]>
  >;
}

/**
 * Creates a submit handler that processes the current selection/input
 * and replaces attachment placeholders with actual payloads.
 */
export function createSubmitHandler(deps: SubmitHandlerDeps): () => void {
  const {
    mode,
    predefinedOptions,
    selectedIndex,
    inputValue,
    queuedAttachments,
    textareaRef,
    onSubmit,
    questionId,
    setQueuedAttachments,
  } = deps;

  return () => {
    let finalValue =
      mode === 'option' && predefinedOptions.length > 0
        ? predefinedOptions[selectedIndex]
        : (safeReadTextarea(textareaRef)?.value ?? inputValue);

    // Replace [Attached file N] placeholders with actual payloads
    queuedAttachments.forEach((attachment, index) => {
      const placeholder = `[Attached file ${index + 1}]`;
      const regex = new RegExp(placeholder.replace(/[[\]]/g, '\\$&'), 'g');
      finalValue = finalValue.replace(regex, attachment.payload);
    });

    onSubmit(questionId, finalValue);
    setQueuedAttachments([]);
  };
}
