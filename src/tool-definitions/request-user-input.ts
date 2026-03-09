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
    },
    required: ['projectName', 'message', 'baseDirectory'],
  },
};

// Define description conforming to ToolRegistrationDescription
const registrationDescription: ToolRegistrationDescription = (
  globalTimeoutSeconds: number,
) => `<description>
Send a question to the user via an interactive prompt surface. **Crucial for clarifying requirements, confirming plans, or resolving ambiguity.**
You should call this tool whenever it has **any** uncertainty or needs clarification or confirmation, even for trivial or silly questions.
Feel free to ask anything! **Proactive questioning is preferred over making assumptions.**
</description>

<importantNotes>
- (!important!) **Use this tool FREQUENTLY** for any question that requires user input or confirmation.
- (!important!) Continue to generate existing messages after user answers.
- (!important!) Provide predefined options for quick selection if applicable.
- (!important!) **Essential for validating assumptions before proceeding with significant actions (e.g., code edits, running commands).**
- (!important!) **Do not exit the prompt loop** until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) Immediately before final/closing handoff, ask exactly: "Are you satisfied with this result, or would you like any changes?"
- (!important!) If a required prompt times out or response is empty, re-prompt indefinitely and do not proceed with assumptions.
- (!important!) If the user skips a requested command/script, ask why it was skipped and whether to continue with alternatives or stop.
</importantNotes>

<whenToUseThisTool>
- Before starting any task, even if requirements appear clear
- After completing any task, to run the mandatory satisfaction check
- When you need clarification on user requirements or preferences
- When multiple implementation approaches are possible and user input is needed
- **Before making potentially impactful changes (code edits, file operations, complex commands)**
- When you need to confirm assumptions before proceeding
- When you need additional information not available in the current context
- When validating potential solutions before implementation
- When facing ambiguous instructions that require clarification
- When seeking feedback on generated code or solutions
- When needing permission to modify critical files or functionality
- When user instructions are conflicting or unclear
- When the user asks to be prompted, asks a direct question, or asks a reply question
- When the user skips a command you requested
- Immediately before any final/closing handoff
- **Whenever you feel even slightly unsure about the user's intent or the correct next step.**
</whenToUseThisTool>

<features>
- Interactive prompt UI with markdown rendering (including code/diff blocks)
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") when provided in the prompt text
- Supports option mode + free-text input mode when predefinedOptions are provided
- Returns user response or timeout notification (timeout defaults to ${globalTimeoutSeconds} seconds)
- Backend-agnostic contract: same request/response behavior regardless of the active UI backend
- Maintains context across user interactions
- Handles empty responses gracefully
- Shows project context in the prompt header/title
- baseDirectory is required, must be the current repository root, and controls file autocomplete/search scope explicitly
</features>

<bestPractices>
- Keep questions concise and specific
- Provide clear options when applicable
- Use markdown for richer context (multiline structure, code fences, unified diff snippets)
- When referencing repository files, prefer VS Code-compatible file links in markdown where helpful
- Do not ask the question if you have another tool that can answer the question
  - e.g. when you searching file in the current repository, do not ask the question "Do you want to search for a file in the current repository?"
  - e.g. prefer to use other tools to find the answer (Cursor tools or other MCP Server tools)
- Limit questions to only what's necessary **to resolve the uncertainty**
- Format complex questions into simple choices
- Reference specific code or files when relevant
- Indicate why the information is needed
- Use appropriate urgency based on importance
</bestPractices>

<parameters>
- projectName: Identifies the context/project making the request (shown in prompt header/title context)
- message: The specific question for the user (prompt body text)
- predefinedOptions: Predefined options for the user to choose from (optional)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- "Should I implement the authentication using JWT or OAuth?"
- "Do you want to use TypeScript interfaces or type aliases for this component?"
- "I found three potential bugs. Should I fix them all or focus on the critical one first?"
- "Can I refactor the database connection code to use connection pooling?"
- "Is it acceptable to add React Router as a dependency?"
- "I plan to modify function X in file Y. Is that correct?"
- { "projectName": "web-app", "message": "Which file should I edit?", "baseDirectory": "/workspace/web-app" }
</examples>`;

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
};

// Combine into a single ToolDefinition object
export const requestUserInputTool: ToolDefinition = {
  capability: capabilityInfo,
  description: registrationDescription,
  schema: rawSchema, // Use the raw shape here
};
