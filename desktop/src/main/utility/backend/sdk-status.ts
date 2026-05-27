import type { FormatterStatus, LspStatus } from '@opencode-ai/sdk/v2/client';
import { getClient } from './sdk-client';

const SDK_STATUS_TIMEOUT_MS = 5_000;

export type OpenCodeSdkStatus = {
  lsp: LspStatus[];
  formatter: FormatterStatus[];
};

export async function fetchOpenCodeSdkStatus(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeSdkStatus> {
  const client = getClient(openCodePort, baseDirectory);
  const [lspResponse, formatterResponse] = await Promise.all([
    client.lsp.status(
      baseDirectory ? { directory: baseDirectory } : undefined,
      { signal: AbortSignal.timeout(SDK_STATUS_TIMEOUT_MS) },
    ),
    client.formatter.status(
      baseDirectory ? { directory: baseDirectory } : undefined,
      { signal: AbortSignal.timeout(SDK_STATUS_TIMEOUT_MS) },
    ),
  ]);

  if (lspResponse.error) {
    throw new Error(`OpenCode LSP status error: ${String(lspResponse.error)}`);
  }
  if (formatterResponse.error) {
    throw new Error(
      `OpenCode formatter status error: ${String(formatterResponse.error)}`,
    );
  }

  return {
    lsp: lspResponse.data ?? [],
    formatter: formatterResponse.data ?? [],
  };
}
