import type { PendingPermission } from '../types';

export type PermissionDisplay = {
  icon: string;
  title: string;
  detail: string | null;
};

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizePath(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^.*\/([^/]+)$/, '$1');
}

export function getPermissionDisplay(
  perm: PendingPermission,
): PermissionDisplay {
  const metadata = perm.metadata ?? {};
  const permission = perm.permission.toLowerCase();

  if (permission === 'edit') {
    const filepath = getString(metadata.filepath);
    return {
      icon: '->',
      title: `Edit ${normalizePath(filepath) ?? 'file'}`,
      detail: filepath,
    };
  }

  if (permission === 'read') {
    const path = perm.patterns?.[0] ?? null;
    return {
      icon: '->',
      title: `Read ${normalizePath(path) ?? 'file'}`,
      detail: path,
    };
  }

  if (permission === 'glob') {
    const pattern = getString(metadata.pattern) ?? perm.patterns?.[0] ?? '';
    return {
      icon: '*',
      title: `Glob "${pattern}"`,
      detail: getString(metadata.path),
    };
  }

  if (permission === 'grep') {
    const pattern = getString(metadata.pattern) ?? perm.patterns?.[0] ?? '';
    const include = getString(metadata.include);
    return {
      icon: '*',
      title: `Grep "${pattern}"`,
      detail: include ? `include: ${include}` : getString(metadata.path),
    };
  }

  if (permission === 'bash') {
    const description = getString(metadata.description);
    return {
      icon: '#',
      title: description ?? 'Shell command',
      detail: perm.patterns?.[0] ?? null,
    };
  }

  if (permission === 'task') {
    const type = getString(metadata.subagent_type) ?? 'agent';
    return {
      icon: '#',
      title: `${type} task`,
      detail: getString(metadata.description),
    };
  }

  if (permission === 'webfetch') {
    const url = getString(metadata.url) ?? perm.patterns?.[0] ?? '';
    return {
      icon: '%',
      title: `WebFetch ${url}`,
      detail: getString(metadata.format),
    };
  }

  if (permission === 'websearch') {
    const query = getString(metadata.query) ?? perm.patterns?.[0] ?? '';
    return { icon: '<>', title: `Web search "${query}"`, detail: null };
  }

  if (permission === 'codesearch') {
    const query = getString(metadata.query) ?? perm.patterns?.[0] ?? '';
    return { icon: '<>', title: `Code search "${query}"`, detail: null };
  }

  if (permission === 'external_directory') {
    const dir =
      getString(metadata.parentDir) ??
      getString(metadata.filepath) ??
      perm.patterns?.[0] ??
      '';
    return {
      icon: '<-',
      title: `Access external directory ${normalizePath(dir) ?? dir}`,
      detail: dir,
    };
  }

  if (permission === 'doom_loop') {
    return {
      icon: '~',
      title: 'Continue after repeated failures',
      detail: null,
    };
  }

  return {
    icon: '!',
    title: `Call tool ${perm.permission}`,
    detail: perm.patterns?.[0] ?? null,
  };
}
