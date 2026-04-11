import { useState, useEffect, useRef } from 'react';

type ShortcutCallbacks = {
  onSwitchTab: (tab: 1 | 2 | 3) => void;
  onOpenQuickSwitcher?: () => void;
};

export function useGlobalShortcuts({
  onSwitchTab,
  onOpenQuickSwitcher,
}: ShortcutCallbacks) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const showRef = useRef(showShortcuts);
  const quickSwitcherRef = useRef(showQuickSwitcher);
  const switchRef = useRef(onSwitchTab);
  const openQuickSwitcherRef = useRef(onOpenQuickSwitcher);

  useEffect(() => {
    showRef.current = showShortcuts;
  }, [showShortcuts]);

  useEffect(() => {
    quickSwitcherRef.current = showQuickSwitcher;
  }, [showQuickSwitcher]);

  useEffect(() => {
    switchRef.current = onSwitchTab;
  }, [onSwitchTab]);

  useEffect(() => {
    openQuickSwitcherRef.current = onOpenQuickSwitcher;
  }, [onOpenQuickSwitcher]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;

      // Quick switcher: Cmd+K / Ctrl+K
      if (meta && e.key === 'k') {
        e.preventDefault();
        setShowQuickSwitcher((prev) => !prev);
        openQuickSwitcherRef.current?.();
        return;
      }

      if (meta && e.key === '1') {
        e.preventDefault();
        switchRef.current(1);
        return;
      }
      if (meta && e.key === '2') {
        e.preventDefault();
        switchRef.current(2);
        return;
      }
      if (meta && e.key === '3') {
        e.preventDefault();
        switchRef.current(3);
        return;
      }
      if (
        (meta && e.key === '/') ||
        (e.key === '?' &&
          !meta &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target instanceof HTMLInputElement))
      ) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        if (quickSwitcherRef.current) {
          e.preventDefault();
          setShowQuickSwitcher(false);
          return;
        }
        if (showRef.current) {
          e.preventDefault();
          setShowShortcuts(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return {
    showShortcuts,
    openShortcuts: () => setShowShortcuts(true),
    closeShortcuts: () => setShowShortcuts(false),
    showQuickSwitcher,
    openQuickSwitcher: () => setShowQuickSwitcher(true),
    closeQuickSwitcher: () => setShowQuickSwitcher(false),
  };
}
