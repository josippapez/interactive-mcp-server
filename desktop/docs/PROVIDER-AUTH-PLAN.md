# Provider Auth Implementation Plan

This document tracks the implementation of OpenCode provider authentication in the interactive-mcp-desktop app, enabling users to connect AI providers (API key or OAuth) directly from the desktop UI.

## Overview

The OpenCode server exposes 4 provider-related API endpoints. The desktop app currently fetches provider/model lists but has **no auth flow** — users must configure providers via the OpenCode CLI. This plan adds full provider auth support.

## OpenCode API Reference

| Endpoint                        | Method | Purpose                           | Response                                                    |
| ------------------------------- | ------ | --------------------------------- | ----------------------------------------------------------- |
| `/provider`                     | GET    | List providers + connected status | `{ all: Provider[], default: Record, connected: string[] }` |
| `/provider/auth`                | GET    | Get auth methods per provider     | `Record<string, AuthMethod[]>`                              |
| `/provider/:id/oauth/authorize` | POST   | Start OAuth flow                  | `{ url, method: "auto"\|"code", instructions }`             |
| `/provider/:id/oauth/callback`  | POST   | Complete OAuth with code          | `boolean`                                                   |

### Auth Method Schema

```typescript
type AuthMethod = {
  type: 'oauth' | 'api';
  label: string;
  prompts?: Array<TextPrompt | SelectPrompt>;
};

type TextPrompt = {
  type: 'text';
  key: string;
  message: string;
  placeholder?: string;
  when?: { key: string; op: 'eq' | 'neq'; value: string };
};

type SelectPrompt = {
  type: 'select';
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
  when?: { key: string; op: 'eq' | 'neq'; value: string };
};

type Authorization = {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
};
```

### Auth Flow

1. **API Key**: User pastes key → `POST /auth/set { providerID, auth: { type: "api", key } }`
2. **OAuth (auto)**: App calls authorize → opens browser URL → callback auto-completes → token stored
3. **OAuth (code)**: App calls authorize → user visits URL → copies code → app sends callback with code → token stored

---

## Implementation Checklist

### Layer 1: Main Process API Functions

- [ ] Add `fetchProviderAuthMethods(port)` → `GET /provider/auth`
- [ ] Add `authorizeProvider(port, providerId, methodIndex, inputs?)` → `POST /provider/:id/oauth/authorize`
- [ ] Add `callbackProvider(port, providerId, methodIndex, code?)` → `POST /provider/:id/oauth/callback`
- [ ] Add `setProviderApiKey(port, providerId, apiKey)` → `POST /auth/set`
- [ ] Update `fetchProviders()` to also return `connected` array
- [ ] Export all from `desktop/src/main/opencode/index.ts`
- [ ] Write tests for all new functions in `desktop/src/main/opencode/provider.test.ts`

**Files**: `desktop/src/main/opencode/provider.ts`, `desktop/src/main/opencode/provider.test.ts`

### Layer 2: IPC Handlers

- [ ] Register `fetch-provider-auth-methods` handler
- [ ] Register `authorize-provider` handler
- [ ] Register `callback-provider` handler
- [ ] Register `set-provider-api-key` handler

**Files**: `desktop/src/main/ipc/handlers.ts`

### Layer 3: Preload Bridge

- [ ] Expose `fetchProviderAuthMethods()` to renderer
- [ ] Expose `authorizeProvider(providerId, methodIndex, inputs?)` to renderer
- [ ] Expose `callbackProvider(providerId, methodIndex, code?)` to renderer
- [ ] Expose `setProviderApiKey(providerId, apiKey)` to renderer

**Files**: `desktop/src/preload/index.ts`

### Layer 4: React Hook — `useProviderAuth`

- [ ] Create state machine hook: idle → selectMethod → prompts → pending → complete → error
- [ ] `fetchMethods(providerId)` — fetches auth methods for a provider
- [ ] `selectMethod(index)` — selects an auth method, triggers OAuth if applicable
- [ ] `submitApiKey(key)` — submits API key for "api" type methods
- [ ] `submitOAuthCode(code)` — submits OAuth code for "code" method
- [ ] `submitPromptInputs(inputs)` — submits prompt form values for OAuth methods with prompts
- [ ] `reset()` — resets state machine to idle
- [ ] Write tests for pure state transition logic

**Files**: `desktop/src/renderer/src/hooks/useProviderAuth.ts`, `desktop/src/renderer/src/hooks/useProviderAuth.test.ts`

### Layer 5: UI Components

- [ ] Create `ConnectProviderDialog` component with multi-step flow:
  - Step 1: Select provider (list of unconnected providers)
  - Step 2: Select auth method (if multiple available — OAuth vs API key)
  - Step 3a: API key form (text input + submit)
  - Step 3b: OAuth prompts form (text/select inputs based on `prompts` array)
  - Step 3c: OAuth pending (spinner while waiting for authorize response)
  - Step 4a: OAuth auto — show confirmation code + "Waiting..." + auto-callback
  - Step 4b: OAuth code — show URL link + code input form + submit
  - Step 5: Success toast / error display
- [ ] Add "Connect Provider" button to `ModelSelector` component
- [ ] Show connected/unconnected status badges on providers

**Files**: `desktop/src/renderer/src/components/prompt/ConnectProviderDialog.tsx`, `desktop/src/renderer/src/components/prompt/ModelSelector.tsx`

### Layer 6: Integration & Polish

- [ ] Update `useProviders` hook to expose `connected` array from API
- [ ] Refresh provider list after successful auth (call `refresh()`)
- [ ] Handle provider disconnect (future — out of scope for v1)
- [ ] Update `OPENCODE-FEATURES-ROADMAP.md` to mark Provider API as implemented
- [ ] Update `IPC-API.md` with new IPC handlers

---

## Reference Implementation

The OpenCode TUI app (Solid.js) implements this flow in:

- `packages/app/src/components/dialog-select-provider.tsx` — Provider selection list
- `packages/app/src/components/dialog-connect-provider.tsx` — Full auth flow (654 lines)
- `packages/app/src/hooks/use-providers.ts` — Provider data hook
- `packages/opencode/src/server/instance/provider.ts` — Server routes
- `packages/opencode/src/provider/auth.ts` — Auth types and service

## Dependencies

- No new npm packages required
- Uses existing `fetch()` for API calls (same pattern as all other OpenCode integrations)
- Shell `open` command for launching OAuth URLs in browser (via Electron's `shell.openExternal`)
