import { useState, useCallback } from 'react';
import type { Attachment } from '../types';

export type UseAttachmentsReturn = {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleFilePicker: () => Promise<void>;
  removeAttachment: (index: number) => void;
};

/**
 * Manages the list of file/image attachments for the channel composer.
 * Handles clipboard image paste and file-picker attachment flows.
 */
export function useAttachments(enabled: boolean): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!enabled) return;
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          if (!base64) return;
          setAttachments((prev) => [
            ...prev,
            {
              data: base64,
              mimeType: file.type || 'image/png',
              name: file.name || `pasted-image-${Date.now()}.png`,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    },
    [enabled],
  );

  const handleFilePicker = useCallback(async () => {
    if (!enabled) return;
    const paths = await window.api.openFileDialog();
    for (const filePath of paths) {
      const result = await window.api.readFileForAttachment(filePath);
      if (!result) continue;
      setAttachments((prev) => [
        ...prev,
        {
          data: result.data,
          mimeType: result.mimeType,
          name: result.name,
          size: result.size,
        },
      ]);
    }
  }, [enabled]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    attachments,
    setAttachments,
    handlePaste,
    handleFilePicker,
    removeAttachment,
  };
}
