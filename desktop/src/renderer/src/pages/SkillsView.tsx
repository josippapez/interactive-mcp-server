import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';

type SkillOrInstruction = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  enabled: boolean;
  isBuiltin: boolean;
  category: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
};

type TabType = 'all' | 'skill' | 'instruction';

const PREDEFINED_CATEGORIES = [
  'Code Review',
  'Testing',
  'Documentation',
  'Workflow',
  'Style Guide',
  'Other',
];

export default function SkillsView(): React.ReactElement {
  const [entries, setEntries] = useState<SkillOrInstruction[]>([]);
  const [tab, setTab] = useState<TabType>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SkillOrInstruction | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Category filter for sidebar
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'skill' | 'instruction'>('skill');
  const [formDescription, setFormDescription] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTags, setFormTags] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Export status
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const exportStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Single-entry export status
  const [singleExportStatus, setSingleExportStatus] = useState<string | null>(
    null,
  );
  const singleExportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const loadEntries = useCallback(async () => {
    const result = await window.api.listSkillsAndInstructions(
      undefined,
      categoryFilter || undefined,
    );
    setEntries(result);
  }, [categoryFilter]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // Listen for live updates from the main process (when agents register skills via tool)
  useEffect(() => {
    window.api.onSkillsUpdated(() => {
      void loadEntries();
    });
  }, [loadEntries]);

  const handleSelect = useCallback((entry: SkillOrInstruction) => {
    setSelected(entry);
    setIsEditing(false);
    setIsCreating(false);
    setFormName(entry.name);
    setFormType(entry.type);
    setFormDescription(entry.description);
    setFormContent(entry.content);
    setFormCategory(entry.category ?? '');
    setFormTags(entry.tags?.join(', ') ?? '');
  }, []);

  const handleCreate = useCallback(() => {
    setSelected(null);
    setIsCreating(true);
    setIsEditing(false);
    setFormName('');
    setFormType(tab === 'skill' || tab === 'instruction' ? tab : 'skill');
    setFormDescription('');
    setFormContent('');
    setFormCategory('');
    setFormTags('');
  }, [tab]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setIsCreating(false);
  }, []);

  const handleCancel = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      return;
    }
    if (selected) {
      setFormName(selected.name);
      setFormType(selected.type);
      setFormDescription(selected.description);
      setFormContent(selected.content);
      setFormCategory(selected.category ?? '');
      setFormTags(selected.tags?.join(', ') ?? '');
    }
    setIsEditing(false);
  }, [isCreating, selected]);

  const handleSave = useCallback(async () => {
    if (!formName.trim() || !formDescription.trim() || !formContent.trim()) {
      setSaveStatus('All fields are required.');
      if (saveStatusTimeoutRef.current)
        clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = setTimeout(
        () => setSaveStatus(null),
        3000,
      );
      return;
    }

    // Parse tags from comma-separated string
    const parsedTags = formTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const result = await window.api.upsertSkillOrInstruction({
      name: formName.trim(),
      type: formType,
      description: formDescription.trim(),
      content: formContent.trim(),
      category: formCategory.trim() || null,
      tags: parsedTags.length > 0 ? parsedTags : null,
    });

    if (result) {
      setSaveStatus(isCreating ? 'Created successfully.' : 'Saved.');
      setIsEditing(false);
      setIsCreating(false);
      setSelected(result);
      await loadEntries();
    } else {
      setSaveStatus('Failed to save.');
    }

    if (saveStatusTimeoutRef.current)
      clearTimeout(saveStatusTimeoutRef.current);
    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus(null), 2000);
  }, [
    formName,
    formType,
    formDescription,
    formContent,
    formCategory,
    formTags,
    isCreating,
    loadEntries,
  ]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await window.api.deleteSkillOrInstruction(deleteTarget);
    setDeleteTarget(null);
    if (selected?.name === deleteTarget) {
      setSelected(null);
      setIsEditing(false);
    }
    await loadEntries();
  }, [deleteTarget, selected, loadEntries]);

  const handleToggleEnabled = useCallback(
    async (name: string, currentEnabled: boolean) => {
      await window.api.toggleSkillOrInstructionEnabled(name, !currentEnabled);
      await loadEntries();
      // Update selected if it's the one being toggled
      if (selected?.name === name) {
        setSelected((prev) =>
          prev ? { ...prev, enabled: !currentEnabled } : null,
        );
      }
    },
    [loadEntries, selected?.name],
  );

  const handleDuplicate = useCallback(
    async (name: string) => {
      const duplicated = await window.api.duplicateSkillOrInstruction(name);
      if (duplicated) {
        await loadEntries();
        // Select the duplicated entry and open in edit mode
        setSelected(duplicated);
        setIsEditing(true);
        setIsCreating(false);
        setFormName(duplicated.name);
        setFormType(duplicated.type);
        setFormDescription(duplicated.description);
        setFormContent(duplicated.content);
        setFormCategory(duplicated.category ?? '');
        setFormTags(duplicated.tags?.join(', ') ?? '');
      }
    },
    [loadEntries],
  );

  useEffect(() => {
    return () => {
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
    };
  }, []);

  const handleExport = useCallback(async () => {
    const result = await window.api.exportSkillsMarkdown();
    if (exportStatusTimeoutRef.current)
      clearTimeout(exportStatusTimeoutRef.current);
    if (result.saved) {
      setExportStatus('Exported.');
    } else {
      setExportStatus(null);
    }
    exportStatusTimeoutRef.current = setTimeout(
      () => setExportStatus(null),
      2500,
    );
  }, []);

  const handleExportSingle = useCallback(async (name: string) => {
    const result = await window.api.exportSingleSkill(name);
    if (singleExportTimeoutRef.current)
      clearTimeout(singleExportTimeoutRef.current);
    if (result.saved) {
      setSingleExportStatus('Exported.');
    } else {
      setSingleExportStatus(null);
    }
    singleExportTimeoutRef.current = setTimeout(
      () => setSingleExportStatus(null),
      2500,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (exportStatusTimeoutRef.current) {
        clearTimeout(exportStatusTimeoutRef.current);
      }
      if (singleExportTimeoutRef.current) {
        clearTimeout(singleExportTimeoutRef.current);
      }
    };
  }, []);

  const isFormMode = isEditing || isCreating;

  // Collect all unique categories from entries for the filter dropdown
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const e of entries) {
      if (e.category) cats.add(e.category);
    }
    // Merge with predefined categories
    for (const c of PREDEFINED_CATEGORIES) {
      cats.add(c);
    }
    return Array.from(cats).sort();
  }, [entries]);

  // Derive the visible list from tab + search query + category filter
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (tab !== 'all' && e.type !== tab) return false;
      // categoryFilter is applied via API, but double-check here for safety
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [entries, tab, search, categoryFilter]);

  const skills = visibleEntries.filter((e) => e.type === 'skill');
  const instructions = visibleEntries.filter((e) => e.type === 'instruction');

  // Tab counts (unfiltered by search so badges show totals)
  const allCount = entries.length;
  const skillCount = entries.filter((e) => e.type === 'skill').length;
  const instructionCount = entries.filter(
    (e) => e.type === 'instruction',
  ).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar — list of skills/instructions */}
      <aside className="w-64 border-r border-[var(--color-border)] flex flex-col shrink-0">
        {/* Header: title row + action buttons row */}
        <div className="px-3 pt-3 pb-2 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-medium text-[var(--color-text)] mb-1.5">
            Skills &amp; Instructions
          </h2>
          <div className="flex items-center justify-end gap-1 mb-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              title="Export all as ZIP"
              className="px-2.5 py-1 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Export all
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="px-2.5 py-1 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              + New
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-0.5 mb-2">
            {(
              [
                { key: 'all', label: 'All', count: allCount },
                { key: 'skill', label: 'Skills', count: skillCount },
                {
                  key: 'instruction',
                  label: 'Instructions',
                  count: instructionCount,
                },
              ] as { key: TabType; label: string; count: number }[]
            ).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[10px] rounded-sm transition-colors cursor-pointer ${
                  tab === key
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]'
                    : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50'
                }`}
              >
                {label}
                <span
                  className={`text-[9px] px-1 rounded-full ${
                    tab === key
                      ? 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                      : 'text-[var(--color-text-faint)]'
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* Category filter dropdown */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full mb-2 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-xs text-[var(--color-text)]"
          >
            <option value="">All Categories</option>
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Search input */}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-2 py-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
          />

          {exportStatus && (
            <p className="mt-1.5 text-[10px] text-[var(--color-text-faint)]">
              {exportStatus}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleEntries.length === 0 ? (
            <div className="p-3 text-xs text-[var(--color-text-faint)]">
              {search || categoryFilter
                ? `No matches${search ? ` for "${search}"` : ''}${categoryFilter ? ` in category "${categoryFilter}"` : ''}.`
                : 'No entries yet. Click "+ New" to create one, or use the manage_skills_and_instructions tool from an agent.'}
            </div>
          ) : (
            <>
              {(tab === 'all' || tab === 'skill') && skills.length > 0 && (
                <div>
                  {tab === 'all' && (
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                      Skills ({skills.length})
                    </div>
                  )}
                  {skills.map((entry) => (
                    <SidebarItem
                      key={entry.id}
                      entry={entry}
                      isSelected={selected?.id === entry.id}
                      onSelect={handleSelect}
                      onDelete={(name) => setDeleteTarget(name)}
                      onToggleEnabled={handleToggleEnabled}
                    />
                  ))}
                </div>
              )}
              {(tab === 'all' || tab === 'instruction') &&
                instructions.length > 0 && (
                  <div>
                    {tab === 'all' && (
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                        Instructions ({instructions.length})
                      </div>
                    )}
                    {instructions.map((entry) => (
                      <SidebarItem
                        key={entry.id}
                        entry={entry}
                        isSelected={selected?.id === entry.id}
                        onSelect={handleSelect}
                        onDelete={(name) => setDeleteTarget(name)}
                        onToggleEnabled={handleToggleEnabled}
                      />
                    ))}
                  </div>
                )}
            </>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && !isCreating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-[var(--color-text-muted)] mb-2">
                Select a skill or instruction from the sidebar
              </p>
              <p className="text-xs text-[var(--color-text-faint)]">
                Skills and instructions are injected into every agent session
                automatically.
              </p>
              <p className="text-xs text-[var(--color-text-faint)] mt-1">
                Agents can also manage them via the
                manage_skills_and_instructions tool.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium text-[var(--color-text)]">
                {isCreating
                  ? 'New Entry'
                  : isEditing
                    ? `Edit: ${selected?.name}`
                    : selected?.name}
              </h3>
              {!isFormMode && selected && (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-2 items-center">
                    {/* Toggle switch */}
                    <button
                      type="button"
                      onClick={() =>
                        void handleToggleEnabled(
                          selected.name,
                          selected.enabled,
                        )
                      }
                      className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                        selected.enabled
                          ? 'bg-[var(--color-agent)]'
                          : 'bg-[var(--color-border)]'
                      }`}
                      aria-label={
                        selected.enabled
                          ? 'Disable this entry'
                          : 'Enable this entry'
                      }
                      title={
                        selected.enabled
                          ? 'Enabled — click to disable'
                          : 'Disabled — click to enable'
                      }
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          selected.enabled ? 'left-4' : 'left-0.5'
                        }`}
                      />
                    </button>
                    <span className="text-[10px] text-[var(--color-text-faint)] w-14">
                      {selected.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleExportSingle(selected.name)}
                      className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDuplicate(selected.name)}
                      className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={handleEdit}
                      className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(selected.name)}
                      className="px-2 py-1 text-xs rounded-sm border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                  {singleExportStatus && (
                    <span className="text-[10px] text-[var(--color-text-faint)]">
                      {singleExportStatus}
                    </span>
                  )}
                </div>
              )}
            </div>

            {isFormMode ? (
              /* Edit / Create form */
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. code-review, typescript-rules"
                    disabled={isEditing && !isCreating}
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)] disabled:opacity-50"
                  />
                  {isEditing && !isCreating && (
                    <p className="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                      Name cannot be changed after creation.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Type
                  </label>
                  <select
                    value={formType}
                    onChange={(e) =>
                      setFormType(e.target.value as 'skill' | 'instruction')
                    }
                    className="w-40 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)]"
                  >
                    <option value="skill">Skill</option>
                    <option value="instruction">Instruction</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    list="category-options"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="Select or type a category"
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
                  />
                  <datalist id="category-options">
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Tags
                  </label>
                  <input
                    type="text"
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    placeholder="Comma-separated tags, e.g. react, typescript, testing"
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Short summary of what this does"
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    Content (Markdown)
                  </label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="Full content body — supports Markdown"
                    rows={16}
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] resize-y focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    className="px-3 py-1.5 text-xs rounded-sm bg-[var(--color-agent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    {isCreating ? 'Create' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  {saveStatus && (
                    <span className="text-xs text-[var(--color-text-faint)]">
                      {saveStatus}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              /* Read-only view */
              selected && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] rounded-sm border ${
                        selected.type === 'skill'
                          ? 'border-[var(--color-agent)]/30 text-[var(--color-agent)] bg-[var(--color-agent)]/10'
                          : 'border-[var(--color-user)]/30 text-[var(--color-user)] bg-[var(--color-user)]/10'
                      }`}
                    >
                      {selected.type}
                    </span>
                    {selected.category && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--color-tool)]/30 text-[var(--color-tool)] bg-[var(--color-tool)]/10">
                        {selected.category}
                      </span>
                    )}
                    {selected.tags &&
                      selected.tags.length > 0 &&
                      selected.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-surface)]"
                        >
                          {tag}
                        </span>
                      ))}
                    <span className="text-xs text-[var(--color-text-faint)]">
                      Updated {selected.updatedAt}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--color-text-muted)]">
                    {selected.description}
                  </p>

                  <div className="border-t border-[var(--color-border)] pt-3">
                    <pre className="text-xs leading-relaxed text-[var(--color-text)] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-sm p-3 overflow-x-auto whitespace-pre-wrap">
                      {selected.content}
                    </pre>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        label={deleteTarget ?? ''}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SidebarItem({
  entry,
  isSelected,
  onSelect,
  onDelete,
  onToggleEnabled,
}: {
  entry: SkillOrInstruction;
  isSelected: boolean;
  onSelect: (entry: SkillOrInstruction) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={`w-full text-left px-3 py-2 text-xs transition-colors group ${
        isSelected
          ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
      } ${!entry.enabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-medium flex items-center gap-1">
          {entry.name}
          {entry.isBuiltin && (
            <span
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-tool)]/20 text-[var(--color-tool)]"
              title="Built-in template"
            >
              Built-in
            </span>
          )}
          {!entry.enabled && (
            <span
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-text-faint)]/20 text-[var(--color-text-faint)]"
              title="Disabled - will not be injected into agent sessions"
            >
              Off
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {/* Toggle switch */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnabled(entry.name, entry.enabled);
            }}
            className={`relative w-6 h-3.5 rounded-full transition-colors cursor-pointer ${
              entry.enabled
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
            aria-label={`${entry.enabled ? 'Disable' : 'Enable'} ${entry.name}`}
            title={entry.enabled ? 'Disable' : 'Enable'}
          >
            <span
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                entry.enabled ? 'left-3' : 'left-0.5'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.name);
            }}
            className="opacity-0 group-hover:opacity-100 text-[var(--color-text-faint)] hover:text-[var(--color-error)] transition-all cursor-pointer text-[10px]"
            aria-label={`Delete ${entry.name}`}
          >
            x
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
        {entry.category && (
          <span className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-tool)]/10 text-[var(--color-tool)]">
            {entry.category}
          </span>
        )}
        {entry.tags &&
          entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1 py-0.5 text-[8px] rounded bg-[var(--color-surface)] text-[var(--color-text-faint)]"
            >
              {tag}
            </span>
          ))}
        {entry.tags && entry.tags.length > 2 && (
          <span className="text-[8px] text-[var(--color-text-faint)]">
            +{entry.tags.length - 2}
          </span>
        )}
      </div>
      <p className="truncate text-[var(--color-text-faint)] mt-0.5">
        {entry.description}
      </p>
    </button>
  );
}
