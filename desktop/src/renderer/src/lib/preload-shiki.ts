import type { BundledLanguage } from 'shiki';
import { highlightCode } from '@/components/ai-elements/code-block';

/**
 * Warm Shiki's highlighter cache for the languages that appear most often
 * in diff/code rendering in this app. Each call triggers `createHighlighter`
 * for the given language, but all cached results are shared with every
 * `CodeBlock` / `DiffView` render via the `highlighterCache` + `tokensCache`
 * singletons in `code-block.tsx`.
 *
 * This runs **fire-and-forget** on app boot so the first diff/code block
 * the user sees in a hot language highlights instantly instead of briefly
 * flashing plain text while Shiki loads.
 *
 * Languages are intentionally limited to a small "hot set" — Shiki's
 * grammar chunks are code-split by the bundler, so each entry below
 * triggers a small async chunk download. Adding more languages grows
 * the initial network cost.
 */
const PRELOAD_LANGUAGES: readonly BundledLanguage[] = [
  // Web / JS ecosystem
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'jsonc',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  // Docs / config
  'markdown',
  'mdx',
  'yaml',
  'toml',
  'xml',
  'ini',
  // Shell / infra
  'bash',
  'docker',
  'sql',
  'graphql',
  // Systems
  'python',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'lua',
];

/** Tiny snippet used purely to trigger grammar load; content is irrelevant. */
const WARMUP_SOURCE = '//\n';

export function preloadShikiLanguages(): void {
  for (const lang of PRELOAD_LANGUAGES) {
    // highlightCode returns `null` on cache miss and schedules an async
    // load; we don't need the result, we just want the side-effect of
    // populating the highlighter cache.
    highlightCode(WARMUP_SOURCE, lang);
  }
}
