export type PromptData = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  baseDirectory?: string;
};

export type ChatMessage = {
  type: 'question' | 'answer';
  text: string;
  timestamp: Date;
};

export type ConnectionState = {
  id: string;
  name: string;
  prompt: PromptData | null;
  activeSession: { id: string; title: string } | null;
  chatHistory: ChatMessage[];
};
