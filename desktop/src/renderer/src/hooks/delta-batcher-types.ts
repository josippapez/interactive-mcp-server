import type {
  ConversationMessagePart,
  ConversationPartType,
} from '../../../preload/index';

export interface TextDelta {
  sessionId: string;
  messageId: string;
  partId: string;
  text: string;
}

export interface PendingPart {
  sessionId: string;
  messageId: string;
  part: ConversationMessagePart;
}

export type DeltaBuffer = Map<string, TextDelta>;
export type PendingPartsBuffer = Map<string, PendingPart>;
export type PartType = ConversationPartType;
