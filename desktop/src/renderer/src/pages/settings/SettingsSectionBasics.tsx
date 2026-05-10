import ProviderAuthSection from '../../components/auth/ProviderAuthSection';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { NumberInput, Toggle } from './SettingsFormParts';
import type { AppSettings } from './settings-types';

type SharedProps = {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
};

type ResolvedPorts = {
  mcpRequestedPort: number;
  mcpResolvedPort: number;
  openCodeRequestedPort: number;
  openCodeResolvedPort: number;
};

/**
 * Tracks the actually-bound MCP/OpenCode ports for the read-only "currently
 * bound on port X" hint. The user's port inputs are hints; when the
 * configured port is occupied, the resolver probes upward and binds the
 * next free port. Surfacing this read-only keeps the user informed
 * without overwriting their saved hint.
 *
 * One-shot fetch on mount (covers the case where main has already
 * resolved before the Settings page mounts), then push-based updates
 * via `onResolvedPortsChanged` — the event carries the full payload, so
 * no follow-up IPC roundtrip is needed.
 */
function useResolvedPorts(): ResolvedPorts | null {
  const [resolved, setResolved] = useState<ResolvedPorts | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.api
      .getResolvedPorts()
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        /* non-fatal — UI just hides the hint */
      });
    const unsubscribe = window.api.onResolvedPortsChanged((payload) => {
      if (!cancelled) setResolved(payload);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return resolved;
}

function ResolvedPortHint({
  requested,
  resolved,
}: {
  requested: number;
  resolved: number;
}): React.ReactElement | null {
  if (resolved === requested) return null;
  return (
    <p className="text-xs text-[var(--color-text-muted)] mt-1">
      Currently bound on port <strong>{resolved}</strong> (requested {requested}
      ; another process held the configured port, so the resolver probed
      upward).
    </p>
  );
}

export function ServerSection({
  portInput,
  setPortInput,
  openCodePortInput,
  setOpenCodePortInput,
  timeoutInput,
  setTimeoutInput,
  isPortValid,
  isOpenCodePortValid,
  isTimeoutValid,
}: {
  portInput: string;
  setPortInput: (value: string) => void;
  openCodePortInput: string;
  setOpenCodePortInput: (value: string) => void;
  timeoutInput: string;
  setTimeoutInput: (value: string) => void;
  isPortValid: boolean;
  isOpenCodePortValid: boolean;
  isTimeoutValid: boolean;
}): React.ReactElement {
  const resolved = useResolvedPorts();
  return (
    <div className="space-y-2">
      <NumberInput
        id="settings-port"
        value={portInput}
        onChange={setPortInput}
        label="MCP Server Port"
        description="Range: 1024–65535. Requires restart if changed."
        min={1024}
        max={65535}
        isValid={isPortValid}
        errorMessage="Enter a valid port between 1024 and 65535."
      />
      {resolved && (
        <ResolvedPortHint
          requested={resolved.mcpRequestedPort}
          resolved={resolved.mcpResolvedPort}
        />
      )}
      <NumberInput
        id="settings-opencode-port"
        value={openCodePortInput}
        onChange={setOpenCodePortInput}
        label="Provider API Port"
        description="Port used to inject context into provider sessions."
        min={1024}
        max={65535}
        isValid={isOpenCodePortValid}
        errorMessage="Enter a valid port between 1024 and 65535."
      />
      {resolved && (
        <ResolvedPortHint
          requested={resolved.openCodeRequestedPort}
          resolved={resolved.openCodeResolvedPort}
        />
      )}
      <NumberInput
        id="settings-timeout"
        value={timeoutInput}
        onChange={setTimeoutInput}
        label="Prompt Timeout (seconds)"
        description="How long to wait for a response before timeout. 0 = no timeout."
        min={0}
        isValid={isTimeoutValid}
        errorMessage="Timeout must be 0 or greater."
      />
    </div>
  );
}

export function ProviderSection({
  settings,
  setSettings,
  providerStatusText,
  syncStatus,
  setSyncStatus,
}: SharedProps & {
  providerStatusText: string | null;
  syncStatus: string | null;
  setSyncStatus: (value: string | null) => void;
}): React.ReactElement {
  const isOpenCodeBackend = settings.agentBackend === 'opencode';
  return (
    <div className="space-y-2">
      <div className="py-3">
        <label
          htmlFor="settings-agent-backend"
          className="block text-sm text-[var(--color-text-muted)] mb-1"
        >
          Agent Backend
        </label>
        <select
          id="settings-agent-backend"
          value={settings.agentBackend}
          onChange={(e) => {
            const nextBackend = e.target.value as AppSettings['agentBackend'];
            setSettings((s) =>
              s
                ? {
                    ...s,
                    agentBackend: nextBackend,
                    autoStartOpenCode:
                      nextBackend === 'opencode' ? true : s.autoStartOpenCode,
                  }
                : s,
            );
          }}
          className="w-56 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="standalone">Standalone (no provider)</option>
          <option value="opencode">OpenCode (provider)</option>
          <option value="claude_sdk">Claude SDK (planned)</option>
        </select>
        {providerStatusText && (
          <p className="text-xs text-[var(--color-warning,orange)] mt-1">
            {providerStatusText}
          </p>
        )}
      </div>

      {isOpenCodeBackend && (
        <>
          <Toggle
            id="settings-auto-start"
            checked={settings.autoStartOpenCode}
            onChange={() =>
              setSettings((s) =>
                s ? { ...s, autoStartOpenCode: !s.autoStartOpenCode } : s,
              )
            }
            label="Auto-start OpenCode server"
            description="Automatically run opencode serve on startup"
          />
          <Toggle
            id="settings-auto-sync"
            checked={settings.autoSyncOpencode}
            onChange={() =>
              setSettings((s) =>
                s ? { ...s, autoSyncOpencode: !s.autoSyncOpencode } : s,
              )
            }
            label="Auto-sync OpenCode config"
            description="Write a remote MCP entry into opencode.json on startup"
          />

          <div className="py-3 border-t border-[var(--color-border)] mt-4">
            <Button
              variant="outline"
              onClick={async () => {
                setSyncStatus(null);
                try {
                  const result = await window.api.syncOpencodeConfig();
                  setSyncStatus(result);
                } catch {
                  setSyncStatus('error');
                }
                setTimeout(() => setSyncStatus(null), 4000);
              }}
            >
              Register OpenCode config
            </Button>
            {syncStatus && <p className="text-xs mt-1">{syncStatus}</p>}
          </div>
        </>
      )}

      <ProviderAuthSection isOpenCodeEnabled={isOpenCodeBackend} />
    </div>
  );
}

export function SessionSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <Toggle
        id="settings-auto-restore"
        checked={settings.autoRestoreSessions}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoRestoreSessions: !s.autoRestoreSessions } : s,
          )
        }
        label="Auto-restore unfinished sessions"
        description="Reopen persisted session tabs when the app starts"
      />
      <Toggle
        id="settings-auto-register"
        checked={settings.autoRegisterSubagents}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoRegisterSubagents: !s.autoRegisterSubagents } : s,
          )
        }
        label="Auto-register sessions"
        description="Automatically add all OpenCode sessions as channels"
      />
    </div>
  );
}

export function DocumentationSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <Toggle
        id="settings-doc-indexing"
        checked={settings.docIndexingEnabled}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, docIndexingEnabled: !s.docIndexingEnabled } : s,
          )
        }
        label="Repository Doc Indexing"
        description="Index and inject repo docs when an agent connects"
      />
      <Toggle
        id="settings-doc-debug"
        checked={settings.docContextDebug}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, docContextDebug: !s.docContextDebug } : s,
          )
        }
        label="Doc Context Debug Mode"
        description="Inject doc context without wrapper tags"
      />
    </div>
  );
}
