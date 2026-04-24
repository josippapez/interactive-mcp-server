import {
  BookOpen,
  Braces,
  FilePenLine,
  FilePlus,
  Files,
  GitCommitVertical,
  Glasses,
  Globe,
  ListChecks,
  ListTodo,
  Search,
  SearchCode,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { getToolInputSummary } from './ToolCallShared';

/**
 * Central registry for per-tool presentation (icon + title + subtitle).
 *
 * Mirrors opencode's `getToolInfo` registry at
 * `packages/ui/src/components/message-part.tsx` L320-470.
 *
 * Keep this file self-contained — no imports from DefaultToolCard or
 * TaskToolCard. ToolCallShared is fine (pure helpers).
 */
export type ToolPresentation = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
};

const BASH_SUBTITLE_MAX = 80;

/** Strip `mcp__<server>__<tool>` or `<server>::<tool>` → `<tool>` */
function stripMcpPrefix(name: string): string {
  // mcp__server__tool → tool
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];
  // server::tool → tool
  const colonIdx = name.indexOf('::');
  if (colonIdx >= 0) return name.slice(colonIdx + 2);
  return name;
}

/** Capitalize first letter and replace underscores with spaces. */
function humanizeToolName(name: string): string {
  const cleaned = stripMcpPrefix(name).replace(/_/g, ' ').trim();
  if (!cleaned) return name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function basename(pathLike: string): string {
  const idx = Math.max(pathLike.lastIndexOf('/'), pathLike.lastIndexOf('\\'));
  return idx >= 0 ? pathLike.slice(idx + 1) : pathLike;
}

function getPathField(input: Record<string, unknown>): string | undefined {
  for (const key of ['filePath', 'path', 'file']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function getStringField(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Discriminator used by ToolCallView dispatchers, if helpful. */
export type ToolClassification =
  | 'task'
  | 'read'
  | 'grep'
  | 'glob'
  | 'bash'
  | 'webfetch'
  | 'write'
  | 'edit'
  | 'todo'
  | 'patch'
  | 'lsp'
  | 'default';

/**
 * Visual category used by CSS to apply a left-accent stripe and
 * category-tinted hover surface around tool triggers. Mirrors the
 * per-tool `ToolClassification` but collapses semantically-similar
 * tools into a single visual band so the sidebar reads as a palette
 * (blue = filesystem, amber = shell, violet = web, teal = MCP/LSP,
 * neutral = default, red = error state applied at runtime).
 */
export type ToolCategory =
  | 'file'
  | 'shell'
  | 'web'
  | 'mcp'
  | 'todo'
  | 'task'
  | 'default';

/** Detect whether a raw tool name comes from an MCP server namespace. */
function isMcpToolName(name: string): boolean {
  return /^mcp__/.test(name) || name.includes('::');
}

export function classifyTool(name: string): ToolClassification {
  const key = stripMcpPrefix(name).toLowerCase();
  if (key === 'task') return 'task';
  if (key === 'read') return 'read';
  if (key === 'grep') return 'grep';
  if (key === 'glob') return 'glob';
  if (key === 'bash') return 'bash';
  if (key === 'webfetch' || key === 'fetch') return 'webfetch';
  if (key === 'write') return 'write';
  if (key === 'edit') return 'edit';
  if (key === 'todowrite' || key === 'todoread') return 'todo';
  if (key === 'patch' || key === 'apply_patch' || key === 'applypatch') {
    return 'patch';
  }
  if (key.startsWith('lsp_') || key.startsWith('lsp-')) return 'lsp';
  return 'default';
}

/**
 * Map a raw tool name to the visual category used by the card shell
 * CSS (`[data-tool-category='…']`). The classifier already handles
 * `mcp__server__tool` and `server::tool` prefixing — here we only need
 * to detect "is this an MCP/remote tool" separately because the
 * classifier collapses all unknown MCP tools into `'default'`.
 */
export function getToolCategory(name: string): ToolCategory {
  const kind = classifyTool(name);
  switch (kind) {
    case 'read':
    case 'write':
    case 'edit':
    case 'glob':
    case 'grep':
    case 'patch':
      return 'file';
    case 'bash':
      return 'shell';
    case 'webfetch':
      return 'web';
    case 'todo':
      return 'todo';
    case 'task':
      return 'task';
    case 'lsp':
      return 'mcp';
    default:
      return isMcpToolName(name) ? 'mcp' : 'default';
  }
}

export function getToolPresentation(
  name: string,
  input: unknown,
): ToolPresentation {
  const safeInput: Record<string, unknown> =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const kind = classifyTool(name);

  switch (kind) {
    case 'read': {
      const path = getPathField(safeInput);
      return {
        icon: Glasses,
        title: 'Read',
        subtitle: path ? basename(path) : undefined,
      };
    }
    case 'grep': {
      return {
        icon: SearchCode,
        title: 'Search',
        subtitle: getStringField(safeInput, 'pattern'),
      };
    }
    case 'glob': {
      return {
        icon: Files,
        title: 'Find',
        subtitle: getStringField(safeInput, 'pattern'),
      };
    }
    case 'bash': {
      const cmd = getStringField(safeInput, 'command', 'cmd', 'script');
      return {
        icon: Terminal,
        title: 'Shell',
        subtitle: cmd ? truncate(cmd, BASH_SUBTITLE_MAX) : undefined,
      };
    }
    case 'webfetch': {
      const url = getStringField(safeInput, 'url', 'uri', 'endpoint');
      return {
        icon: Globe,
        title: 'Fetch',
        subtitle: url ? hostnameOf(url) : undefined,
      };
    }
    case 'write': {
      const path = getPathField(safeInput);
      return {
        icon: FilePlus,
        title: 'Write',
        subtitle: path ? basename(path) : undefined,
      };
    }
    case 'edit': {
      const path = getPathField(safeInput);
      return {
        icon: FilePenLine,
        title: 'Edit',
        subtitle: path ? basename(path) : undefined,
      };
    }
    case 'task': {
      const agent = getStringField(safeInput, 'subagent_type');
      const title = agent
        ? agent.charAt(0).toUpperCase() + agent.slice(1)
        : 'Agent';
      return {
        icon: ListTodo,
        title,
        subtitle: getStringField(safeInput, 'description'),
      };
    }
    case 'todo': {
      return { icon: ListChecks, title: 'Todos' };
    }
    case 'patch': {
      const path = getPathField(safeInput);
      return {
        icon: GitCommitVertical,
        title: 'Patch',
        subtitle: path ? basename(path) : undefined,
      };
    }
    case 'lsp': {
      const tail = stripMcpPrefix(name).replace(/^lsp[_-]/i, '');
      return {
        icon: Braces,
        title: 'LSP',
        subtitle: tail ? tail.replace(/_/g, ' ') : undefined,
      };
    }
    default: {
      // Fallback: humanized tool name + best-effort summary from the
      // pre-existing generic summarizer (backwards-compat).
      const fallbackSubtitle =
        getToolInputSummary(name, safeInput) ?? undefined;
      return {
        icon: Wrench,
        title: humanizeToolName(name),
        subtitle: fallbackSubtitle,
      };
    }
  }
}

export { BookOpen, Search }; // re-export fallback icons so callers can swap
