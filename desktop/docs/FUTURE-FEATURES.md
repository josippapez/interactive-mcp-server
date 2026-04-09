# Shipped Features Index

This file is a lightweight index of features that were designed and shipped. Detailed implementation docs live in the canonical references linked below.

---

## `register_connection` — Named Agent Channels

Agents call `register_connection` at session start to claim a named channel in the sidebar. Includes OpenCode session auto-detection, ID-file persistence, and stale-session guards.

**Reference:** [`TOOLS.md` → `register_connection`](./TOOLS.md#register_connection)

---

## noReply OpenCode Injection

When a user sends a message from the composer, the app simultaneously queues it in SQLite and POSTs it to the OpenCode session API (`noReply: true`). Injection failure is non-fatal.

**Reference:** [`SESSION-CHANNELS.md` → noReply injection](./SESSION-CHANNELS.md#noreply-opencode-injection), [`IPC-API.md`](./IPC-API.md#opencode-injection)

---

## `send_message` — Agent-to-User Direct Messages

A non-blocking MCP tool that pushes a persistent, Markdown-rendered message into channel history without requiring an active prompt. Stored as `agent_message` in the DB.

**Reference:** [`TOOLS.md` → `send_message`](./TOOLS.md#send_message)

---

## `manage_skills_and_instructions` — Skills & Instructions Store

Agents can register, list, retrieve, and delete named skills and instructions via MCP. All entries are auto-injected into every new agent session at `register_connection` time. The renderer's `SkillsView` tab exposes full CRUD and Markdown export.

**Reference:** [`TOOLS.md` → `manage_skills_and_instructions`](./TOOLS.md#manage_skills_and_instructions), [`RENDERER.md` → SkillsView](./RENDERER.md#613-skillsview)

---

## Repository Doc Indexing

Automatic background indexing of the agent's `baseDirectory` for hybrid keyword + semantic search. Used to inject relevant docs into session context ahead of user replies.

**Reference:** [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`TOOLS.md`](./TOOLS.md)
