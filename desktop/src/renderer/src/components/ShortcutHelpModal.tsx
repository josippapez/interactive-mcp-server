import React from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ShortcutHelpModal({
  open,
  onClose,
}: Props): React.ReactElement | null {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-sm p-5 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-[var(--color-text)]">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs"
          >
            ESC
          </button>
        </div>
        <div className="space-y-2 text-xs">
          <ShortcutRow keys="⌘ + K" desc="Quick switcher" />
          <ShortcutRow keys="⌘ + Enter" desc="Submit response" />
          <ShortcutRow keys="⌘ + 1" desc="Prompts tab" />
          <ShortcutRow keys="⌘ + 2" desc="Skills tab" />
          <ShortcutRow keys="⌘ + 3" desc="Settings tab" />
          <ShortcutRow keys="⌘ + /" desc="Toggle this help" />
          <ShortcutRow keys="⌘ + V" desc="Paste image" />
          <ShortcutRow keys="Esc" desc="Close autocomplete / overlay" />
          <ShortcutRow keys="↑ ↓" desc="Navigate autocomplete" />
          <ShortcutRow keys="Tab / Enter" desc="Apply autocomplete" />
          <ShortcutRow keys="#" desc="File search" />
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({
  keys,
  desc,
}: {
  keys: string;
  desc: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-1 border-b border-[var(--color-border)]">
      <span className="text-[var(--color-text-muted)]">{desc}</span>
      <kbd className="px-1.5 py-0.5 rounded-sm bg-[var(--color-kbd-bg)] text-[var(--color-text-muted)] font-mono text-[10px]">
        {keys}
      </kbd>
    </div>
  );
}
