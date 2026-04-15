import { useMemo } from 'react';
import { Button } from './ui/button';

type Props = {
  filePath: string;
  onSelectFolder: (folderPath: string) => void;
  onCancel: () => void;
};

/**
 * Extract the immediate parent folder of a file path.
 */
function extractImmediateFolder(filePath: string): string {
  const parts = filePath.split('/');
  // Remove the file name to get the directory
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * Find the likely project root by looking for depth-2 or depth-3 directory
 * that could be a project folder.
 */
function findProjectRoot(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean);

  // Common patterns:
  // /Users/username/Desktop/project-name/... -> /Users/username/Desktop/project-name
  // /home/user/projects/repo/... -> /home/user/projects/repo

  // Look for ~/Desktop, ~/Documents, ~/projects, etc.
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (
      [
        'desktop',
        'documents',
        'projects',
        'repos',
        'code',
        'dev',
        'work',
      ].includes(part)
    ) {
      // The next directory is likely the project root
      if (i + 1 < parts.length) {
        return '/' + parts.slice(0, i + 2).join('/');
      }
    }
  }

  // Fallback: if we have at least 4 parts (e.g., /Users/name/folder/project/...),
  // return the 4th level as a potential project root
  if (parts.length >= 4) {
    return '/' + parts.slice(0, 4).join('/');
  }

  return null;
}

/**
 * Modal for selecting which folder to allow for auto-approval.
 * Shows immediate parent folder and detected project root.
 */
export default function AllowFolderModal({
  filePath,
  onSelectFolder,
  onCancel,
}: Props): React.ReactElement {
  const folderOptions = useMemo(() => {
    const options: { label: string; path: string }[] = [];

    // Immediate parent folder
    const immediateFolder = extractImmediateFolder(filePath);
    if (immediateFolder && immediateFolder !== '/') {
      const folderName = immediateFolder.split('/').pop() || immediateFolder;
      options.push({
        label: `Current folder (${folderName})`,
        path: immediateFolder,
      });
    }

    // Project root (detected heuristically)
    const projectRoot = findProjectRoot(filePath);
    if (projectRoot && projectRoot !== immediateFolder) {
      const projectName = projectRoot.split('/').pop() || projectRoot;
      options.push({
        label: `Project root (${projectName})`,
        path: projectRoot,
      });
    }

    return options;
  }, [filePath]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Allow Folder for Auto-Approval
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Future file read requests from this folder will be auto-approved.
          </p>
        </div>

        {/* File path preview */}
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-[10px] text-[var(--color-text-faint)] mb-1">
            File requested:
          </p>
          <p className="text-xs font-mono text-[var(--color-text-muted)] break-all">
            {filePath}
          </p>
        </div>

        {/* Folder options */}
        <div className="px-4 py-3">
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
            Select folder to allow:
          </p>
          <div className="space-y-2">
            {folderOptions.map((option) => (
              <button
                key={option.path}
                type="button"
                onClick={() => onSelectFolder(option.path)}
                className="w-full text-left px-3 py-2 rounded border border-[var(--color-border)] hover:border-[var(--color-agent)] hover:bg-[var(--color-agent)]/5 transition-colors"
              >
                <p className="text-xs font-medium text-[var(--color-text)]">
                  {option.label}
                </p>
                <p className="text-[10px] font-mono text-[var(--color-text-muted)] break-all mt-0.5">
                  {option.path}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)]">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
