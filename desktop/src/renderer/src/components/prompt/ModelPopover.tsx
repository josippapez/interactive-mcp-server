import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import type { Model, Provider } from '../../hooks/useProviders';
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
  PopoverPositioner,
} from '../ui/popover';

interface ModelPopoverProps {
  /** Whether the popover is open */
  isOpen: boolean;
  /** Close the popover */
  onClose: () => void;
  /** List of available models */
  models: Model[];
  /** List of providers for grouping */
  providers: Provider[];
  /** Currently selected model ID */
  currentModelId?: string | null;
  /** Callback when a model is selected */
  onSelectModel: (model: Model) => void;
}

/** Thinking/reasoning icon */
function ThinkingIcon(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6h.01M10 6h.01M6 10c.5.5 1.5 1 2 1s1.5-.5 2-1" />
    </svg>
  );
}

/** Group models by provider */
function groupModelsByProvider(
  models: Model[],
  providers: Provider[],
): Map<string, Model[]> {
  const grouped = new Map<string, Model[]>();

  // Initialize with provider order
  for (const provider of providers) {
    grouped.set(provider.id, []);
  }

  // Add models to their providers
  for (const model of models) {
    const existing = grouped.get(model.providerId) ?? [];
    existing.push(model);
    grouped.set(model.providerId, existing);
  }

  return grouped;
}

function ModelPopover({
  isOpen,
  onClose,
  models,
  providers,
  currentModelId,
  onSelectModel,
}: ModelPopoverProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when popover opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Handle model selection
  const handleSelectModel = (model: Model) => {
    onSelectModel(model);
    onClose();
    setSearchQuery('');
  };

  // Filter models by search query
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) {
      return models;
    }

    const query = searchQuery.toLowerCase();
    return models.filter((model) => {
      return (
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        model.providerName.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, models]);

  // Group filtered models by provider
  const groupedModels = useMemo(() => {
    return groupModelsByProvider(filteredModels, providers);
  }, [filteredModels, providers]);

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setSearchQuery('');
        }
      }}
    >
      <PopoverAnchor render={<div className="absolute left-0 bottom-0" />} />
      <PopoverPositioner side="top" align="start" sideOffset={4}>
        <PopoverContent className="min-w-[240px] max-w-[320px] p-0">
          {/* Search input */}
          <div className="px-2 py-2 border-b border-[var(--color-border)]">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search models..."
              className="w-full text-[11px] px-2 py-1.5 rounded-md bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none focus:border-[var(--color-agent)]/40"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {Array.from(groupedModels.entries()).map(
              ([providerId, providerModels]) => {
                if (providerModels.length === 0) return null;

                const provider = providers.find((p) => p.id === providerId);
                if (!provider) return null;

                return (
                  <div key={providerId}>
                    <div className="px-2 py-1.5 text-[10px] font-medium text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] sticky top-0">
                      {provider.name}
                    </div>
                    {providerModels.map((model) => {
                      const isSelected = model.id === currentModelId;
                      const hasVariants =
                        model.variants && model.variants.length > 0;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleSelectModel(model)}
                          className={`w-full px-2 py-1.5 text-left text-[11px] flex items-center justify-between gap-2 transition-colors ${
                            isSelected
                              ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                              : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <span className="truncate">{model.name}</span>
                            {model.reasoning && (
                              <span
                                className="text-[var(--color-text-muted)]"
                                title="Reasoning model"
                              >
                                <ThinkingIcon />
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {model.isFree && (
                              <span
                                className="text-[9px] font-medium text-emerald-500 whitespace-nowrap"
                                title="No token cost"
                              >
                                Free
                              </span>
                            )}
                            {model.contextWindow && (
                              <span className="text-[9px] text-[var(--color-text-faint)] whitespace-nowrap">
                                {Math.round(model.contextWindow / 1000)}K
                              </span>
                            )}
                            {hasVariants && (
                              <span
                                className="text-[9px] text-[var(--color-text-faint)]"
                                title="Has effort variants"
                              >
                                ⚡
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              },
            )}
            {filteredModels.length === 0 && searchQuery.trim() && (
              <div className="px-3 py-3 text-[11px] text-[var(--color-text-faint)] text-center">
                No models match &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>
        </PopoverContent>
      </PopoverPositioner>
    </Popover>
  );
}

export default memo(ModelPopover);
