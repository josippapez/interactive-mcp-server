/**
 * ProviderIcon — renders a provider logo from the bundled SVG sprite.
 *
 * Mirrors opencode's `packages/ui/src/components/provider-icon.tsx` pattern:
 * bundle a single sprite.svg (sourced from opencode upstream) and reference
 * individual symbols via `<use href="sprite.svg#id">`. The sprite lives at
 * `src/renderer/src/assets/provider-icons/sprite.svg`; Vite resolves the
 * `?url` import to a hashed URL at build time.
 *
 * Replaces the previous emoji-based `getProviderIcon()` helper (see
 * GAP_REPORT.md §8.1 / Wave 3 win #2).
 *
 * Usage:
 *   <ProviderIcon id="anthropic" className="size-4" />
 *
 * Unknown ids fall back to "synthetic" (a generic placeholder in the sprite).
 */
// @ts-expect-error — Vite `?url` suffix returns the hashed asset URL as a string.
import spriteUrl from '../assets/provider-icons/sprite.svg?url';

// Subset of opencode's iconNames kept inline so TS can validate known ids.
// If a new provider needs an icon, add it here AND ensure the id exists in
// `src/renderer/src/assets/provider-icons/sprite.svg` (copied from
// ~/Desktop/opencode/packages/ui/src/components/provider-icons/sprite.svg).
const KNOWN_IDS = new Set<string>([
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'azure',
  'amazon-bedrock',
  'groq',
  'mistral',
  'cohere',
  'ollama-cloud',
  'github-copilot',
  'openrouter',
  'xai',
  'perplexity',
  'deepseek',
  'huggingface',
  'fireworks-ai',
  'togetherai',
  'cerebras',
  'nvidia',
  'vercel',
  'v0',
  'llama',
  'moonshotai',
  'zhipuai',
  'opencode',
  'synthetic',
]);

// Map our app's provider ids to sprite ids (opencode uses slightly different naming).
const ID_ALIASES: Record<string, string> = {
  gemini: 'google',
  bedrock: 'amazon-bedrock',
  amazon: 'amazon-bedrock',
  'azure-openai': 'azure',
  copilot: 'github-copilot',
  ollama: 'ollama-cloud',
  local: 'opencode',
  custom: 'synthetic',
};

function resolveIconId(providerId: string): string {
  const lower = providerId.toLowerCase();
  if (KNOWN_IDS.has(lower)) return lower;
  const aliased = ID_ALIASES[lower];
  if (aliased && KNOWN_IDS.has(aliased)) return aliased;
  return 'synthetic';
}

type ProviderIconProps = React.SVGProps<SVGSVGElement> & {
  id: string;
  /** Size in px for both width + height. Defaults to 16. */
  size?: number;
};

export function ProviderIcon({
  id,
  size = 16,
  className,
  ...rest
}: ProviderIconProps): React.ReactElement {
  const iconId = resolveIconId(id);
  return (
    <svg
      data-component="provider-icon"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <use href={`${spriteUrl}#${iconId}`} />
    </svg>
  );
}

export default ProviderIcon;
