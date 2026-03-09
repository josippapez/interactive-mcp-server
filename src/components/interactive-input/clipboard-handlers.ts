import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  copyTextToClipboard as copyToSystemClipboard,
  readFilePathsFromClipboard,
  readImageDataUrlFromClipboard,
  readTextFromClipboard,
} from '@/utils/clipboard.js';
import {
  buildAttachmentFromPath,
  normalizeClipboardPath,
} from './attachments.js';
import {
  shouldCollapsePastedText,
  type QueuedAttachment,
} from './constants.js';

export interface ClipboardHandlers {
  handlePastedText: (pastedText: string) => void;
  pasteClipboardIntoInput: () => void;
  copyInputToClipboard: () => void;
}

export interface ClipboardHandlerDeps {
  insertTextAtCaret: (text: string) => void;
  queueAttachment: (attachment: QueuedAttachment) => void;
  setClipboardStatus: (status: string) => void;
  onInputActivity?: () => void;
  searchRoot?: string;
  requestInputFocus: () => void;
  textareaRef: {
    current: {
      plainText?: string;
      hasSelection?: () => boolean;
      getSelectedText?: () => string;
    } | null;
  };
  inputValue: string;
  mode: string;
}

export function createClipboardHandlers(
  deps: ClipboardHandlerDeps,
): ClipboardHandlers {
  const {
    insertTextAtCaret,
    queueAttachment,
    setClipboardStatus,
    onInputActivity,
    searchRoot,
    requestInputFocus,
    textareaRef,
    inputValue,
    mode,
  } = deps;

  const handlePastedText = (pastedText: string) => {
    if (!pastedText) {
      return;
    }

    const pasteAsPlainText = () => {
      insertTextAtCaret(pastedText);
      setClipboardStatus('Pasted text');
      onInputActivity?.();
    };

    const normalizedPath = normalizeClipboardPath(pastedText, searchRoot);
    if (normalizedPath) {
      void buildAttachmentFromPath(normalizedPath)
        .then((attachment) => {
          queueAttachment(attachment);
          setClipboardStatus(`Queued ${attachment.label}`);
          onInputActivity?.();
        })
        .catch(() => {
          pasteAsPlainText();
        });
      return;
    }

    if (shouldCollapsePastedText(pastedText)) {
      queueAttachment({
        id: crypto.randomUUID(),
        label: `Pasted text block (${pastedText.length} chars)`,
        payload: pastedText,
      });
      setClipboardStatus('Queued pasted text block');
      onInputActivity?.();
      return;
    }

    pasteAsPlainText();
  };

  const pasteClipboardIntoInput = () => {
    requestInputFocus();

    void readTextFromClipboard()
      .then(async (clipboardText) => {
        if (clipboardText.trim()) {
          handlePastedText(clipboardText);
          return;
        }

        const clipboardPaths = await readFilePathsFromClipboard();
        if (clipboardPaths.length > 0) {
          const attachments = await Promise.all(
            clipboardPaths.map(async (clipboardPath) => {
              try {
                return await buildAttachmentFromPath(clipboardPath);
              } catch {
                return null;
              }
            }),
          );
          const validAttachments = attachments.filter(
            (value): value is QueuedAttachment => value !== null,
          );
          if (validAttachments.length > 0) {
            validAttachments.forEach((attachment) => {
              queueAttachment(attachment);
            });
            setClipboardStatus(
              validAttachments.length === 1
                ? `Queued ${validAttachments[0].label}`
                : `Queued ${validAttachments.length} clipboard files`,
            );
            onInputActivity?.();
            return;
          }
        }

        const imageDataUrl = await readImageDataUrlFromClipboard();
        if (imageDataUrl) {
          try {
            // Extract base64 data and save to temp file
            const base64Data = imageDataUrl.replace(
              /^data:image\/\w+;base64,/,
              '',
            );
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const tempDir = os.tmpdir();
            const tempFileName = `pasted-image-${crypto.randomUUID()}.png`;
            const tempFilePath = path.join(tempDir, tempFileName);

            await fs.writeFile(tempFilePath, imageBuffer);

            // Now queue it as a file attachment
            const attachment = await buildAttachmentFromPath(tempFilePath);
            queueAttachment(attachment);
            setClipboardStatus('Queued clipboard image');
            onInputActivity?.();
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'unknown error';
            setClipboardStatus(
              `Failed to save clipboard image: ${errorMessage}`,
            );
          }
          return;
        }

        setClipboardStatus('Paste failed: clipboard is empty');
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'unknown error';
        setClipboardStatus(`Paste failed: ${errorMessage}`);
      });
  };

  const copyInputToClipboard = () => {
    if (mode !== 'input') {
      return;
    }

    const textarea = textareaRef.current;
    const selectedText =
      typeof textarea?.hasSelection === 'function' &&
      textarea.hasSelection() &&
      typeof textarea?.getSelectedText === 'function'
        ? textarea.getSelectedText()
        : '';
    const fallbackText = textarea?.plainText ?? inputValue;
    const textToCopy = selectedText.length > 0 ? selectedText : fallbackText;

    if (textToCopy.length === 0) {
      setClipboardStatus('Nothing to copy');
      return;
    }

    void copyToSystemClipboard(textToCopy)
      .then(() => {
        setClipboardStatus('Copied input to clipboard');
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'unknown error';
        setClipboardStatus(`Copy failed: ${errorMessage}`);
      });
    onInputActivity?.();
  };

  return {
    handlePastedText,
    pasteClipboardIntoInput,
    copyInputToClipboard,
  };
}
