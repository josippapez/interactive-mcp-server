export type AllowFolderOption = {
  path: string;
  label: string;
  name: string;
  hint: string;
};

function extractImmediateFolder(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function findProjectRoot(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean);

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
      ].includes(part) &&
      i + 1 < parts.length
    ) {
      return '/' + parts.slice(0, i + 2).join('/');
    }
  }

  if (parts.length >= 4) {
    return '/' + parts.slice(0, 4).join('/');
  }

  return null;
}

function getPathName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

export function buildAllowFolderOptions(filePath: string): AllowFolderOption[] {
  const options: AllowFolderOption[] = [];
  const immediateFolder = extractImmediateFolder(filePath);

  if (immediateFolder && immediateFolder !== '/') {
    options.push({
      path: immediateFolder,
      label: 'Current folder',
      name: getPathName(immediateFolder),
      hint: 'Only this immediate folder',
    });
  }

  const projectRoot = findProjectRoot(filePath);
  if (projectRoot && projectRoot !== immediateFolder) {
    options.push({
      path: projectRoot,
      label: 'Project root',
      name: getPathName(projectRoot),
      hint: 'Recommended for this repository',
    });
  }

  return options;
}
