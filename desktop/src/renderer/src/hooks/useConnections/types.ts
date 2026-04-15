import type { ChannelMessage, PromptData } from '../../types';

/**
 * Buffer for channel messages that arrived before their target node existed.
 * Key is connectionId.
 */
export type StartupHistoryBuffer = Map<string, ChannelMessage[]>;

/**
 * Buffer for prompts that arrived before their target node existed.
 * Key is openCodeSessionId (preferred) or connectionId (fallback).
 */
export type StartupPromptBuffer = Map<string, PromptData>;
