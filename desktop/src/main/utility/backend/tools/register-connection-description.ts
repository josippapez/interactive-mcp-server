export const REGISTER_CONNECTION_TOOL_DESCRIPTION = `<description>
Register this agent as a named connection in the Interactive MCP Desktop app.
Call this tool once at the start of every session to establish a persistent, human-readable channel.
After registration, your channel will appear in the app's sidebar with the given name.
</description>

<importantNotes>
- (!important!) Call this tool at the start of each session before using other tools.
- (!important!) If a user deletes your session from the app, call this tool again to re-establish the connection.
- (!important!) Other tools will return an error with instructions to call register_connection if your session has been removed.
- (!important!) The connectionId returned by this tool is automatically used by all other tools.
- (!important!) Use clear, human-readable channelName values so channels are easy to distinguish in the sidebar.
- (!important!) For spawned/parallel subagents, use a unique task label (for example "Research Agent A", "Research Agent B") to avoid duplicate names.
- (!important!) If you pass baseDirectory and omit openCodeSessionId, the desktop app will auto-detect your active session for context injection — this is the correct path for the main agent.
- (!important!) If you are a subagent spawned via the Task tool, your openCodeSessionId was automatically injected into your context via a <system-reminder> message before your first tool call. Use that value as openCodeSessionId here.
- (!important!) SESSION_ALREADY_CLAIMED errors no longer occur. If you see one in old context, ignore it — call register_connection with your openCodeSessionId directly.
- (!important!) This tool has a hard 15-second deadline; if registration does not complete in time, it fails so callers can retry cleanly.
</importantNotes>

<whenToUseThisTool>
- At the very start of each agent session (first tool call)
- After receiving an error message instructing you to re-register
- When resuming work after a long pause and you're unsure if the session is still active
</whenToUseThisTool>

<parameters>
- channelName: Human-readable name for this agent shown in the channel sidebar. Prefer unique names per active agent/session (especially for spawned subagents) to avoid channel-name collisions.
- projectName: Name of the project or workspace this agent is working in.
- baseDirectory: Absolute path to the working directory / repository root (optional but recommended for file autocomplete).
- openCodeSessionId: Your own OpenCode session ID (optional). Pass this explicitly when you know it (e.g. as a subagent). Takes precedence over auto-detection. Enables the desktop app to inject context directly into your session.
</parameters>

<examples>
- { "channelName": "<Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Agent <Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "channelName": "Research <Task name> Agent", "projectName": "literature-review" }
- { "channelName": "Research <Task name> Agent A", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Research <Task name> Agent B", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_def456" }
</examples>`;
