import React, { useEffect, useRef } from 'react';
import { useProviderAuth } from '../../hooks/useProviderAuth';
import type { AuthMethod, AuthPrompt } from '../../../../preload/index';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ProviderAuthModalProps {
  /** The provider ID to authenticate. */
  providerId: string;
  /** The provider display name. */
  providerName: string;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Close the modal. */
  onClose: () => void;
  /** Called when auth succeeds. */
  onSuccess?: () => void;
}

/** Loading spinner component. */
function Spinner(): React.ReactElement {
  return (
    <svg
      className="animate-spin h-5 w-5 text-[var(--color-agent)]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/** Success checkmark icon. */
function CheckIcon(): React.ReactElement {
  return (
    <svg
      className="h-12 w-12 text-green-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

/** Error icon. */
function ErrorIcon(): React.ReactElement {
  return (
    <svg
      className="h-12 w-12 text-[var(--color-error)]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/** Method selection step. */
function MethodSelectionStep({
  methods,
  onSelectMethod,
}: {
  methods: AuthMethod[];
  onSelectMethod: (index: number) => void;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        Choose how you want to connect:
      </p>
      <div className="space-y-2">
        {methods.map((method, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onSelectMethod(index)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] transition-colors text-left"
          >
            <span className="flex items-center gap-3">
              <span className="text-lg">
                {method.type === 'oauth' ? '🔐' : '🔑'}
              </span>
              <span>
                <span className="text-sm font-medium text-[var(--color-text)]">
                  {method.label}
                </span>
                <span className="block text-xs text-[var(--color-text-faint)]">
                  {method.type === 'oauth'
                    ? 'Sign in with browser'
                    : 'Paste API key'}
                </span>
              </span>
            </span>
            <span className="text-[var(--color-text-faint)]">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Text input prompt. */
function TextPromptInput({
  prompt,
  value,
  onChange,
  autoFocus,
}: {
  prompt: AuthPrompt;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  if (prompt.type !== 'text') return <></>;

  const isApiKey = prompt.key === 'apiKey';

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[var(--color-text-muted)]">
        {prompt.message}
      </label>
      <Input
        ref={inputRef}
        type={isApiKey ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={prompt.placeholder ?? ''}
        className="rounded-md bg-[var(--color-surface)] focus:ring-1 focus:ring-[var(--color-agent)]"
      />
    </div>
  );
}

/** Select prompt. */
function SelectPromptInput({
  prompt,
  value,
  onChange,
}: {
  prompt: AuthPrompt;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  if (prompt.type !== 'select') return <></>;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[var(--color-text-muted)]">
        {prompt.message}
      </label>
      <div className="space-y-1">
        {prompt.options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors text-left text-sm ${
              value === option.value
                ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <span>{option.label}</span>
            {option.hint && (
              <span className="text-xs text-[var(--color-text-faint)]">
                {option.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Prompt form step. */
function PromptFormStep({
  prompts,
  inputs,
  currentKey,
  onInputChange,
  onSubmit,
  isSubmitting,
}: {
  prompts: AuthPrompt[];
  inputs: Record<string, string>;
  currentKey: string | null;
  onInputChange: (key: string, value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}): React.ReactElement {
  // Find the current prompt
  const currentPrompt = prompts.find((p) => p.key === currentKey);
  const isLastPrompt = currentKey === null;
  const canSubmit =
    isLastPrompt || (currentPrompt && inputs[currentPrompt.key]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Show all answered prompts + the current one
  const visiblePrompts = prompts.filter(
    (p) => p.key in inputs || p.key === currentKey,
  );

  return (
    <div className="space-y-4" onKeyDown={handleKeyDown}>
      {visiblePrompts.map((prompt) => (
        <div key={prompt.key}>
          {prompt.type === 'text' ? (
            <TextPromptInput
              prompt={prompt}
              value={inputs[prompt.key] ?? ''}
              onChange={(value) => onInputChange(prompt.key, value)}
              autoFocus={prompt.key === currentKey}
            />
          ) : (
            <SelectPromptInput
              prompt={prompt}
              value={inputs[prompt.key] ?? ''}
              onChange={(value) => onInputChange(prompt.key, value)}
            />
          )}
        </div>
      ))}

      <Button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || isSubmitting}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Spinner />
            <span>Connecting...</span>
          </>
        ) : (
          <span>Continue</span>
        )}
      </Button>
    </div>
  );
}

/** OAuth pending step. */
function OAuthPendingStep({
  oauthMethod,
  url,
  instructions,
  onSubmitCode,
  onAutoComplete,
  isSubmitting,
}: {
  oauthMethod: 'auto' | 'code';
  url: string;
  instructions: string;
  onSubmitCode: (code: string) => void;
  onAutoComplete: () => void;
  isSubmitting: boolean;
}): React.ReactElement {
  const [code, setCode] = React.useState('');
  const [opened, setOpened] = React.useState(false);

  const handleOpenUrl = () => {
    window.open(url, '_blank');
    setOpened(true);

    // For auto method, start polling after a delay
    if (oauthMethod === 'auto') {
      setTimeout(() => {
        onAutoComplete();
      }, 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">
        {instructions}
      </div>

      <Button onClick={handleOpenUrl} className="w-full">
        <span>Open Browser</span>
        <span>↗</span>
      </Button>

      {oauthMethod === 'code' && opened && (
        <div className="space-y-3 pt-2">
          <label className="block text-sm font-medium text-[var(--color-text-muted)]">
            Paste the code from the browser:
          </label>
          <Input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter code..."
            className="rounded-md bg-[var(--color-surface)] focus:ring-1 focus:ring-[var(--color-agent)]"
          />
          <Button
            onClick={() => onSubmitCode(code)}
            disabled={!code.trim() || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Spinner />
                <span>Verifying...</span>
              </>
            ) : (
              <span>Submit Code</span>
            )}
          </Button>
        </div>
      )}

      {oauthMethod === 'auto' && opened && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-[var(--color-text-muted)]">
          <Spinner />
          <span>Waiting for browser authorization...</span>
        </div>
      )}
    </div>
  );
}

/** Success step. */
function SuccessStep({
  providerName,
  onClose,
}: {
  providerName: string;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-6 space-y-4">
      <CheckIcon />
      <div className="text-center">
        <h4 className="text-lg font-medium text-[var(--color-text)]">
          Connected!
        </h4>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {providerName} is now available for use.
        </p>
      </div>
      <Button onClick={onClose}>Done</Button>
    </div>
  );
}

/** Error step. */
function ErrorStep({
  error,
  onRetry,
  onClose,
}: {
  error: string;
  onRetry: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-6 space-y-4">
      <ErrorIcon />
      <div className="text-center">
        <h4 className="text-lg font-medium text-[var(--color-text)]">
          Connection Failed
        </h4>
        <p className="text-sm text-[var(--color-error)] mt-1">{error}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onRetry}>Try Again</Button>
      </div>
    </div>
  );
}

/**
 * Modal dialog for provider authentication flow.
 *
 * Steps:
 * 1. Select auth method (if multiple)
 * 2. Enter prompts (API key or OAuth prompts)
 * 3. OAuth pending (for OAuth methods)
 * 4. Success / Error
 */
export default function ProviderAuthModal({
  providerId,
  providerName,
  isOpen,
  onClose,
  onSuccess,
}: ProviderAuthModalProps): React.ReactElement | null {
  const auth = useProviderAuth();
  const modalRef = useRef<HTMLDivElement>(null);

  // Start auth when modal opens
  useEffect(() => {
    if (isOpen && auth.status === 'idle') {
      void auth.startAuth(providerId);
    }
  }, [isOpen, auth.status, providerId, auth.startAuth]);

  // Call onSuccess when auth succeeds
  useEffect(() => {
    if (auth.status === 'success' && onSuccess) {
      onSuccess();
    }
  }, [auth.status, onSuccess]);

  // Reset auth state when modal closes
  useEffect(() => {
    if (!isOpen) {
      auth.reset();
    }
  }, [isOpen, auth.reset]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRetry = () => {
    void auth.startAuth(providerId);
  };

  const handleClose = () => {
    auth.reset();
    onClose();
  };

  const renderContent = (): React.ReactElement => {
    switch (auth.status) {
      case 'idle':
      case 'loading':
        return (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        );

      case 'selecting-method':
        return (
          <MethodSelectionStep
            methods={auth.methods}
            onSelectMethod={(index) => void auth.selectMethod(index)}
          />
        );

      case 'prompts':
        if (!auth.promptState) {
          return (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          );
        }
        return (
          <PromptFormStep
            prompts={auth.promptState.prompts}
            inputs={auth.promptState.inputs}
            currentKey={auth.promptState.currentKey}
            onInputChange={auth.submitPromptInput}
            onSubmit={() => void auth.proceedToAuthorize()}
            isSubmitting={false}
          />
        );

      case 'authorizing':
        return (
          <div className="flex items-center justify-center py-8 gap-2 text-[var(--color-text-muted)]">
            <Spinner />
            <span>Authorizing...</span>
          </div>
        );

      case 'oauth-pending':
        if (!auth.oauthResult) {
          return (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          );
        }
        return (
          <OAuthPendingStep
            oauthMethod={auth.oauthResult.method}
            url={auth.oauthResult.url}
            instructions={auth.oauthResult.instructions}
            onSubmitCode={(code) => void auth.submitOAuthCode(code)}
            onAutoComplete={() => void auth.completeAutoOAuth()}
            isSubmitting={false}
          />
        );

      case 'success':
        return (
          <SuccessStep providerName={providerName} onClose={handleClose} />
        );

      case 'error':
        return (
          <ErrorStep
            error={auth.error ?? 'Unknown error'}
            onRetry={handleRetry}
            onClose={handleClose}
          />
        );

      default:
        return <></>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="w-full max-w-md mx-4 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-auth-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h3
            id="provider-auth-title"
            className="text-base font-medium text-[var(--color-text)]"
          >
            Connect {providerName}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">{renderContent()}</div>
      </div>
    </div>
  );
}
