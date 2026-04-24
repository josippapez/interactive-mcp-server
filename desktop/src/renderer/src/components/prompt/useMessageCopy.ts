import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard hook with a brief "copied" flag for UI feedback.
 *
 * The flag auto-resets after `resetMs` (default 1500ms). Uses the browser
 * `navigator.clipboard` API — the renderer runs in a regular Electron window
 * where this is available. No Tauri shim required.
 */
export function useMessageCopy(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, resetMs);
        return true;
      } catch {
        return false;
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
