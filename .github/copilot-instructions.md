# Copilot instructions for interactive-mcp

- Before starting, read the [instructions](./instructions/) and [skills](./skills/) to understand the available workflows and delegation tools.
- Prefer local repository docs (`README.md` and `/docs`) as the canonical source when implementation behavior is unclear.
- For clarifications, confirmations, or behavior choices, use the **built-in questions tool** (harness-provided `question` / `ask_question` / equivalent).
- Do NOT use interactive MCP prompt tools (`request_user_input`, `start_intensive_chat`, `ask_intensive_chat`, `stop_intensive_chat`, `push_session_status`, `send_message`) for in-repo agent work. That MCP path is deprecated for this repository, though the tool implementations remain in `desktop/src/main/tools/` for external consumers.

## Repository essentials

- This repository implements a local MCP server in Node.js/TypeScript for interactive user communication.
- Runtime and build setup:
  - ESM project (`"type": "module"` in `package.json`)
  - Strict TypeScript with path alias `@/* -> src/*` (`tsconfig.json`)
  - Terminal UI built with React + OpenTUI (`@opentui/core`, `@opentui/react`)
  - Bun runtime entry (`#!/usr/bin/env bun` in `src/index.ts`)
- Main entrypoint: `src/index.ts`
  - Parses CLI args (`--timeout`, `--disable-tools`)
  - Registers MCP tools and capabilities
  - Connects server over stdio transport
- Exposed MCP tools (still implemented for external consumers of the CLI package):
  - `request_user_input`
  - `message_complete_notification`
  - `start_intensive_chat`
  - `ask_intensive_chat`
  - `stop_intensive_chat`
- Core code areas:
  - `src/tool-definitions/*`: tool capability metadata, descriptions, and zod schemas
  - `src/commands/input/*`: single prompt flow with detached terminal window + file-based response
  - `src/commands/intensive-chat/*`: persistent session chat using heartbeat and response files
  - `src/components/InteractiveInput.tsx`: shared keyboard interaction for prompt UIs

## Validation workflow

- Use existing scripts for validation:
  - `bun run lint`
  - `bun run check-types`
  - `bun run build`
- The repo currently has no dedicated automated test suite, so rely on lint/typecheck/build and focused runtime checks for behavior changes.
- Preserve cross-platform process behavior (macOS/Windows/Linux) when changing detached process or IPC logic.

## Agent delegation defaults

- The main agent may spawn both generic subagents and repository custom agents.
- All delegated agents follow the repo's built-in-questions-tool policy when user input is required.
- Prefer repository custom agents for domain-specific work:
  - `interactive-mcp-tooling-specialist`: MCP tool schemas, capabilities, registration, and CLI argument wiring.
  - `ink-terminal-ui-specialist`: OpenTUI/React terminal UI and interactive prompt behavior.
  - `session-process-reliability-specialist`: detached process lifecycle, heartbeat monitoring, temp-file IPC, and cleanup.
  - `docs-maintainer`: documentation synchronization.
- For mixed tasks, split independent subtasks and delegate safely in parallel.
- The main agent always owns final validation and handoff quality.
