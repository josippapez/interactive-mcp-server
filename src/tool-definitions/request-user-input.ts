import { z } from 'zod';
import {
  ToolDefinition,
  ToolCapabilityInfo,
  ToolRegistrationDescription,
} from './types.js'; // Import the types

// Define capability conforming to ToolCapabilityInfo
const capabilityInfo: ToolCapabilityInfo = {
  description:
    'Ask the user a question in an interactive prompt surface and await their reply.',
  parameters: {
    type: 'object',
    properties: {
      projectName: {
        type: 'string',
        description:
          'Identifies the context/project making the request (shown in prompt header/title context)',
      },
      message: {
        type: 'string',
        description: 'The specific question for the user (prompt body text)',
      },
      predefinedOptions: {
        type: 'array',
        items: { type: 'string' },
        optional: true, // Mark as optional here too for consistency
        description:
          'Predefined options for the user to choose from (optional)',
      },
      baseDirectory: {
        type: 'string',
        description:
          'Required absolute path to the current repository root (must be a git repo root; used as file autocomplete/search scope)',
      },
      openCodeSessionId: {
        type: 'string',
        optional: true,
        description:
          'Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios.',
      },
    },
    required: ['projectName', 'message', 'baseDirectory'],
  },
};

// Define description conforming to ToolRegistrationDescription
const registrationDescription: ToolRegistrationDescription = (
  globalTimeoutSeconds: number,
) => `Ask the user a question in an interactive prompt and wait for the reply.

Use it when you are blocked on something only the user can answer: a missing credential, a choice between valid options, or a requirement the task never stated. Do not ask what you can find out with other tools.

- message: the question. Markdown renders, including code and diff blocks.
- predefinedOptions: choices to show. The user can still type a free-text answer.
- baseDirectory: absolute path to the git repository root. It scopes file autocomplete.
- projectName: shown in the prompt header.

Returns the user's answer, or a timeout notice after ${globalTimeoutSeconds} seconds.`;

// Define the Zod schema (as a raw shape object)
const rawSchema: z.ZodRawShape = {
  projectName: z
    .string()
    .describe(
      'Identifies the context/project making the request (shown in prompt header/title context)',
    ),
  message: z
    .string()
    .describe('The specific question for the user (prompt body text)'),
  predefinedOptions: z
    .array(z.string())
    .optional()
    .describe('Predefined options for the user to choose from (optional)'),
  baseDirectory: z
    .string()
    .describe(
      'Required absolute path to the current repository root (must be a git repo root; used as file autocomplete/search scope)',
    ),
  openCodeSessionId: z
    .string()
    .optional()
    .describe(
      'Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios.',
    ),
};

// Combine into a single ToolDefinition object
export const requestUserInputTool: ToolDefinition = {
  capability: capabilityInfo,
  description: registrationDescription,
  schema: rawSchema, // Use the raw shape here
};
