# @rawwee/interactive-mcp

[![npm version](https://img.shields.io/npm/v/%40rawwee%2Finteractive-mcp)](https://www.npmjs.com/package/@rawwee/interactive-mcp) [![npm downloads](https://img.shields.io/npm/dm/%40rawwee%2Finteractive-mcp)](https://www.npmjs.com/package/@rawwee/interactive-mcp) [![GitHub license](https://img.shields.io/github/license/josippapez/interactive-mcp-server)](https://github.com/josippapez/interactive-mcp-server/blob/main/LICENSE) [![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier) [![Platforms](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/josippapez/interactive-mcp-server) [![GitHub last commit](https://img.shields.io/github/last-commit/josippapez/interactive-mcp-server)](https://github.com/josippapez/interactive-mcp-server/commits/main)

## Repository

- GitHub: https://github.com/josippapez/interactive-mcp-server

![Interactive MCP screenshot](https://raw.githubusercontent.com/josippapez/interactive-mcp-server/main/docs/image.png)

A MCP Server implemented in Node.js/TypeScript, facilitating interactive communication between LLMs and users. **Note:** This server is designed to run locally alongside the MCP client (e.g., Claude Desktop, VS Code), as it needs direct access to the user's operating system to display notifications and command-line prompts.

_(Note: This project is in its early stages.)_

## Tools

This server exposes the following tools via the Model Context Protocol (MCP):

- `request_user_input`: Asks the user a question and returns their answer. Can display predefined options.
- `message_complete_notification`: Sends a simple OS notification.
- `start_intensive_chat`: Initiates a persistent command-line chat session.
- `ask_intensive_chat`: Asks a question within an active intensive chat session.
- `stop_intensive_chat`: Closes an active intensive chat session.

Prompt UIs support markdown-friendly question text (including multiline prompts, fenced code blocks, and diff snippets). When useful, you can also include VS Code-style file links in prompt text (for example, `vscode://file/<absolute-path>:<line>:<column>`).
In TUI input mode, `Cmd/Ctrl+C` copies current input, `Cmd/Ctrl+V` supports clipboard text plus file/image includes from pasted paths, copied file objects, and copied images (platform support varies), and `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` provide undo/redo. Files are sent as path references rather than full contents to optimize token usage—the AI can then read files directly using its available tools.

## Usage Scenarios

This server is ideal for scenarios where an LLM needs to interact directly with the user on their local machine, such as:

- Interactive setup or configuration processes.
- Gathering feedback during code generation or modification.
- Clarifying instructions or confirming actions in pair programming.
- Any workflow requiring user input or confirmation during LLM operation.

## Client Configuration

This section explains how to configure MCP clients to use the `@rawwee/interactive-mcp` server package.

By default, user prompts will time out after 30 seconds. You can customize server options like timeout or disabled tools by adding command-line flags directly to the `args` array when configuring your client.

Please make sure you have the `npx` command available.

### Usage with Claude Desktop / Cursor

Add the following minimal configuration to your `claude_desktop_config.json` (Claude Desktop) or `mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "interactive": {
      "command": "npx",
      "args": ["-y", "@rawwee/interactive-mcp"]
    }
  }
}
```

**With specific version**

```json
{
  "mcpServers": {
    "interactive": {
      "command": "npx",
      "args": ["-y", "@rawwee/interactive-mcp@1.9.0"]
    }
  }
}
```

**Example with Custom Timeout (30s):**

```json
{
  "mcpServers": {
    "interactive": {
      "command": "npx",
      "args": ["-y", "@rawwee/interactive-mcp", "-t", "30"]
    }
  }
}
```

### Usage with VS Code

Add the following minimal configuration to your User Settings (JSON) file or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "interactive-mcp": {
        "command": "npx",
        "args": ["-y", "@rawwee/interactive-mcp"]
      }
    }
  }
}
```

#### macOS Recommendations

For a smoother experience on macOS using the default `Terminal.app`, consider this profile setting:

- **(Shell Tab):** Under **"When the shell exits"** (**Terminal > Settings > Profiles > _[Your Profile]_ > Shell**), select **"Close if the shell exited cleanly"** or **"Close the window"**. This helps manage windows when the MCP server starts and stops.

## Development Setup

This section is primarily for developers looking to modify or contribute to the server. If you just want to _use_ the server with an MCP client, see the "Client Configuration" section above.

### Prerequisites

- **Node.js:** Required for runtime execution, TypeScript tooling, and Node APIs used by the server.
- **Bun (optional):** Can be used as an alternative runtime or package manager. If you prefer Bun, set `INTERACTIVE_MCP_RUNTIME=<path-to-bun>` or use `INTERACTIVE_MCP_BUN_PATH` (legacy alias) to point the server's terminal spawner at your Bun binary.

#### Prompt UI runtime fallback (important for npm users)

Interactive prompt UIs (OpenTUI) prefer Bun at runtime. When the MCP server is started with Node, terminal launch runtime is resolved in this order:

1. `INTERACTIVE_MCP_RUNTIME` (or legacy `INTERACTIVE_MCP_BUN_PATH`) if set.
2. Current process runtime if the server is already running on Bun.
3. `bun` found on system `PATH`.
4. Bundled local Bun binary from npm package `bun` (installed with this package).
5. Final fallback to current process runtime (`process.execPath`) with a warning.

This means npm users without a globally installed Bun can still launch prompt UIs via the bundled local Bun fallback.

### Installation (Developers)

1. Clone the repository:

   ```bash
   git clone https://github.com/josippapez/interactive-mcp-server
   cd interactive-mcp-server
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

### Running the Application (Developers)

```bash
npm run start
```

Or directly with Node:

```bash
node dist/index.js
```

### UI backend status

`interactive-mcp` currently runs with the OpenTUI terminal backend (`@opentui/core`, `@opentui/react`).
The VS Code extension and bridge runtime have been removed from the active feature set for now, and may be reconsidered in a future iteration.

#### Command-Line Options

The `interactive-mcp` server accepts the following command-line options. These should typically be configured in your MCP client's JSON settings by adding them directly to the `args` array (see "Client Configuration" examples).

| Option            | Alias | Description                                                                                                                                                                                           |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--timeout`       | `-t`  | Sets the default timeout (in seconds) for user input prompts.                                                                                                                                         |
| `--disable-tools` | `-d`  | Disables specific tools or groups (comma-separated list). Prevents the server from advertising or registering them. Options: `request_user_input`, `message_complete_notification`, `intensive_chat`. |

**Example:** Setting multiple options in the client config `args` array:

```jsonc
// Example combining options in client config's "args":
"args": [
  "-y", "@rawwee/interactive-mcp",
  "-t", "30", // Set timeout to 30 seconds
  "--disable-tools", "message_complete_notification,intensive_chat" // Disable notifications and intensive chat
]
```

## Development Commands

- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Format:** `npm run format`
- **Tests:** `bun test` — unit tests currently use the `bun:test` runner and require Bun as a dev tool.

## Release & Publishing Workflow

Package releases are handled by **GitHub Actions** in `.github/workflows/publish.yml` (manual `workflow_dispatch`).

- Choose `release_type` when running the workflow:
  - `stable` → releases from `main`
  - `rc` → releases from `next`
- The workflow uses:
  - **Node.js 24** (`actions/setup-node`)
- For semantic-release + trusted publishing, keep `actions/setup-node` without `registry-url` to avoid npm auth conflicts (`EINVALIDNPMTOKEN`).
- Release pipeline commands:
  - `npm ci`
  - `npm run build`
  - `npx semantic-release`
- npm publishing uses **trusted publishing (OIDC)** via GitHub Actions (`id-token: write`), not a long-lived npm token.

## Guiding Principles for Interaction

When interacting with this MCP server (e.g., as an LLM client), please adhere to the following principles to ensure clarity and reduce unexpected changes:

- **Prioritize Interaction:** Utilize the provided MCP tools (`request_user_input`, `start_intensive_chat`, etc.) frequently to engage with the user.
- **Seek Clarification:** If requirements, instructions, or context are unclear, **always** ask clarifying questions before proceeding. Do not make assumptions.
- **Confirm Actions:** Before performing significant actions (like modifying files, running complex commands, or making architectural decisions), confirm the plan with the user.
- **Provide Options:** Whenever possible, present the user with predefined options through the MCP tools to facilitate quick decisions.

You can provide these instructions to an LLM client like this:

```markdown
# Interaction

- Please use the interactive MCP tools
- Please provide options to interactive MCP if possible

# Reduce Unexpected Changes

- Do not make assumption.
- Ask more questions before executing, until you think the requirement is clear enough.
```

## Contributing

Contributions are welcome! Please follow standard development practices. (Further details can be added later).

## License

MIT (See `LICENSE` file for details - if applicable, or specify license directly).
