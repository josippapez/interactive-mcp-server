---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction.
---

# Browser Automation with agent-browser

> Source: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)

The CLI uses Chrome/Chromium via CDP directly. Install via `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`. Run `agent-browser install` to download Chrome. Existing Chrome, Brave, Playwright, and Puppeteer installations are detected automatically. Run `agent-browser upgrade` to update to the latest version.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, select
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Command Chaining

Commands can be chained with `&&` in a single shell invocation. The browser persists between commands via a background daemon, so chaining is safe and more efficient than separate calls.

```bash
# Chain open + wait + snapshot in one call
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i

# Chain multiple interactions
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3

# Navigate and capture
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser screenshot page.png
```

**When to chain:** Use `&&` when you don't need to read the output of an intermediate command before proceeding. Run commands separately when you need to parse the output first (e.g., snapshot to discover refs, then interact using those refs).

## Handling Authentication

**Option 1: Import auth from the user's browser (fastest for one-off tasks)**

```bash
agent-browser --auto-connect state save ./auth.json
agent-browser --state ./auth.json open https://app.example.com/dashboard
```

**Option 2: Persistent profile (simplest for recurring tasks)**

```bash
agent-browser --profile ~/.myapp open https://app.example.com/login
```

**Option 3: Session name (auto-save/restore cookies + localStorage)**

```bash
agent-browser --session-name myapp open https://app.example.com/login
```

## Common Commands

| Command                                 | Description                  |
| --------------------------------------- | ---------------------------- |
| `agent-browser open <url>`              | Navigate to a URL            |
| `agent-browser snapshot -i`             | Get interactive element refs |
| `agent-browser click <ref>`             | Click an element             |
| `agent-browser fill <ref> "text"`       | Fill an input                |
| `agent-browser select <ref> "value"`    | Select a dropdown option     |
| `agent-browser screenshot [file]`       | Take a screenshot            |
| `agent-browser wait --load networkidle` | Wait for network idle        |
| `agent-browser eval 'expression'`       | Evaluate JavaScript          |
| `agent-browser close`                   | Close the browser            |
| `agent-browser session list`            | List active sessions         |
| `agent-browser --session <name> <cmd>`  | Run in named session         |

## Tips for Our Repo

- Use for testing HCP Portal pages locally after `npx nx run HCP-Portal:dev`
- Good for visual regression checks and form testing
- Combine with `agent-browser screenshot` for capturing evidence
- Use `--headed` flag during development to see the browser
