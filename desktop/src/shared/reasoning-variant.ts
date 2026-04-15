const TO_CANONICAL_VARIANT: Record<string, string> = {
  max: 'xhigh',
  'x-high': 'xhigh',
};

const TO_PROVIDER_VARIANT: Record<string, string> = {
  xhigh: 'max',
  'x-high': 'max',
};

export function normalizeReasoningVariant(
  variant: string | null | undefined,
): string | undefined {
  if (!variant) return undefined;
  const normalized = variant.trim().toLowerCase();
  if (!normalized) return undefined;
  return TO_CANONICAL_VARIANT[normalized] ?? normalized;
}

export function normalizeReasoningVariants(
  variants: string[] | undefined,
): string[] | undefined {
  if (!variants || variants.length === 0) return undefined;

  const deduped = new Set<string>();
  for (const variant of variants) {
    const normalized = normalizeReasoningVariant(variant);
    if (normalized) deduped.add(normalized);
  }

  return deduped.size > 0 ? Array.from(deduped) : undefined;
}

export function toProviderReasoningVariant(
  variant: string | null | undefined,
): string | undefined {
  const normalized = normalizeReasoningVariant(variant);
  if (!normalized) return undefined;
  return TO_PROVIDER_VARIANT[normalized] ?? normalized;
}

export function formatReasoningVariant(
  variant: string | null | undefined,
): string {
  const normalized = normalizeReasoningVariant(variant);
  if (!normalized) return 'Default';

  if (normalized === 'xhigh') return 'XHigh';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
