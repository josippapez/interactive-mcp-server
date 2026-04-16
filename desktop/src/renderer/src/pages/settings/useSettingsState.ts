import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, SettingsSection } from './settings-types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useSettingsState() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(
    null,
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [portInput, setPortInput] = useState('');
  const [timeoutInput, setTimeoutInput] = useState('');
  const [openCodePortInput, setOpenCodePortInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dbResetStatus, setDbResetStatus] = useState<string | null>(null);
  const [providerStatusText, setProviderStatusText] = useState<string | null>(
    null,
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>('server');

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setInitialSettings(s);
      setPortInput(String(s.port));
      setTimeoutInput(String(s.promptTimeoutSeconds));
      setOpenCodePortInput(String(s.openCodePort));
    });
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    let isActive = true;

    window.api
      .getProviderStatus()
      .then((status) => {
        if (!isActive) {
          return;
        }
        if (status.backend === 'claude_sdk' && status.runtime) {
          setProviderStatusText(status.runtime.message);
          return;
        }
        setProviderStatusText(null);
      })
      .catch(() => {
        if (isActive) {
          setProviderStatusText(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [settings]);

  const port = parseInt(portInput, 10);
  const timeout = parseInt(timeoutInput, 10);
  const openCodePort = parseInt(openCodePortInput, 10);
  const isPortValid = !isNaN(port) && port >= 1024 && port <= 65535;
  const isTimeoutValid = !isNaN(timeout) && timeout >= 0;
  const isOpenCodePortValid =
    !isNaN(openCodePort) && openCodePort >= 1024 && openCodePort <= 65535;
  const isFormValid = isPortValid && isTimeoutValid && isOpenCodePortValid;

  const isDirty = useMemo(() => {
    if (!initialSettings || !settings) {
      return false;
    }

    return (
      portInput !== String(initialSettings.port) ||
      timeoutInput !== String(initialSettings.promptTimeoutSeconds) ||
      openCodePortInput !== String(initialSettings.openCodePort) ||
      settings.soundEnabled !== initialSettings.soundEnabled ||
      settings.launchAtLogin !== initialSettings.launchAtLogin ||
      settings.autoRestoreSessions !== initialSettings.autoRestoreSessions ||
      settings.docIndexingEnabled !== initialSettings.docIndexingEnabled ||
      settings.autoStartOpenCode !== initialSettings.autoStartOpenCode ||
      settings.autoSyncOpencode !== initialSettings.autoSyncOpencode ||
      settings.docContextDebug !== initialSettings.docContextDebug ||
      settings.agentBackend !== initialSettings.agentBackend ||
      settings.autoRegisterSubagents !==
        initialSettings.autoRegisterSubagents ||
      settings.compactMode !== initialSettings.compactMode ||
      settings.hideSystemReminders !== initialSettings.hideSystemReminders ||
      settings.hideDocInjections !== initialSettings.hideDocInjections ||
      JSON.stringify(settings.toolAutoExpandExclusions ?? []) !==
        JSON.stringify(initialSettings.toolAutoExpandExclusions ?? [])
    );
  }, [initialSettings, settings, portInput, timeoutInput, openCodePortInput]);

  const nextSettings =
    settings && isFormValid
      ? {
          ...settings,
          port,
          promptTimeoutSeconds: timeout,
          openCodePort,
        }
      : null;

  useEffect(() => {
    if (!nextSettings || !isDirty) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      setSaveState('saving');
      void window.api
        .saveSettings(nextSettings)
        .then(() => {
          setSettings(nextSettings);
          setInitialSettings(nextSettings);
          setSaveState('saved');

          if (saveStatusTimeoutRef.current) {
            clearTimeout(saveStatusTimeoutRef.current);
          }
          saveStatusTimeoutRef.current = setTimeout(
            () => setSaveState('idle'),
            1500,
          );
        })
        .catch(() => setSaveState('error'));
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [nextSettings, isDirty]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (saveStatusTimeoutRef.current)
        clearTimeout(saveStatusTimeoutRef.current);
    };
  }, []);

  return {
    settings,
    setSettings,
    initialSettings,
    saveState,
    portInput,
    setPortInput,
    timeoutInput,
    setTimeoutInput,
    openCodePortInput,
    setOpenCodePortInput,
    syncStatus,
    setSyncStatus,
    copied,
    setCopied,
    dbResetStatus,
    setDbResetStatus,
    providerStatusText,
    activeSection,
    setActiveSection,
    isPortValid,
    isTimeoutValid,
    isOpenCodePortValid,
    isFormValid,
    isDirty,
  };
}
