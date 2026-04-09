export type ClaudeSdkUnavailableReason =
  | 'module_not_installed'
  | 'missing_api_key'
  | 'init_failed';

export interface ClaudeSdkRuntimeStatus {
  available: boolean;
  reason?: ClaudeSdkUnavailableReason;
  message: string;
}

export interface ClaudeSdkAttachment {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ClaudeSdkInjectResult {
  ok: boolean;
  sessionId?: string;
  responseText?: string;
  error?: string;
}

const claudeSessionByConnectionId = new Map<string, string>();

function isModuleNotInstalledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('cannot find module') ||
    message.includes('failed to resolve module') ||
    message.includes('module not found')
  );
}

export async function detectClaudeSdkRuntime(): Promise<ClaudeSdkRuntimeStatus> {
  try {
    await import('@anthropic-ai/claude-agent-sdk');
  } catch (error) {
    if (isModuleNotInstalledError(error)) {
      return {
        available: false,
        reason: 'module_not_installed',
        message:
          'Claude SDK package is not installed. Running in standalone compatibility mode.',
      };
    }

    return {
      available: false,
      reason: 'init_failed',
      message:
        'Claude SDK failed to initialize. Running in standalone compatibility mode.',
    };
  }

  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasApiKey) {
    return {
      available: false,
      reason: 'missing_api_key',
      message:
        'Claude SDK is installed but ANTHROPIC_API_KEY is missing. Running in standalone compatibility mode.',
    };
  }

  return {
    available: true,
    message: 'Claude SDK backend is available.',
  };
}

function buildClaudePromptWithAttachments(
  message: string,
  attachments?: ClaudeSdkAttachment[],
): string {
  let full = message;
  for (const attachment of attachments ?? []) {
    if (attachment.mimeType.startsWith('image/')) {
      full += `\n\n[Image attached: ${attachment.name}]`;
      continue;
    }
    full += `\n\n--- File: ${attachment.name} ---\n${attachment.data}`;
  }
  return full;
}

function extractAssistantText(chunk: unknown): string {
  const typed = chunk as {
    type?: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
  };

  if (typed.type !== 'assistant') return '';
  const content = typed.message?.content ?? [];
  const textParts = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);

  return textParts.join('');
}

function extractSessionId(chunk: unknown): string | null {
  const candidate = (chunk as { session_id?: unknown }).session_id;
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  return candidate;
}

export async function injectClaudeMessageForConnection(params: {
  connectionId: string;
  message: string;
  baseDirectory?: string;
  attachments?: ClaudeSdkAttachment[];
}): Promise<ClaudeSdkInjectResult> {
  const runtime = await detectClaudeSdkRuntime();
  if (!runtime.available) {
    return { ok: false, error: runtime.message };
  }

  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const previousSessionId = claudeSessionByConnectionId.get(
      params.connectionId,
    );
    const fullPrompt = buildClaudePromptWithAttachments(
      params.message,
      params.attachments,
    );

    const options: Record<string, unknown> = {
      persistSession: true,
    };
    if (previousSessionId) {
      options.resume = previousSessionId;
    }
    if (params.baseDirectory) {
      options.cwd = params.baseDirectory;
    }

    const stream = sdk.query({
      prompt: fullPrompt,
      options,
    });

    let sessionId = previousSessionId ?? null;
    const responses: string[] = [];

    for await (const chunk of stream as AsyncIterable<unknown>) {
      const discoveredSessionId = extractSessionId(chunk);
      if (discoveredSessionId) {
        sessionId = discoveredSessionId;
      }

      const assistantText = extractAssistantText(chunk);
      if (assistantText.length > 0) {
        responses.push(assistantText);
      }
    }

    if (sessionId) {
      claudeSessionByConnectionId.set(params.connectionId, sessionId);
    }

    return {
      ok: true,
      sessionId: sessionId ?? undefined,
      responseText: responses.join('\n').trim() || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
