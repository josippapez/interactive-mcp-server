import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  type Folder,
  type InstructionDeliveryMode,
  type SkillOrInstruction,
  type SkillScope,
  type TabType,
  PREDEFINED_CATEGORIES,
} from './skills/skills-types';
import { getInstructionDeliveryMode } from './skills/instruction-delivery';
import { SkillsSidebar } from './skills/SkillsSidebar';
import { SkillEditor } from './skills/SkillEditor';
import { SkillDetailView } from './skills/SkillDetailView';
import { SkillsEmptyState } from './skills/SkillsEmptyState';

export default function SkillsView(): React.ReactElement {
  const [entries, setEntries] = useState<SkillOrInstruction[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tab, setTab] = useState<TabType>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SkillOrInstruction | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Sidebar filters
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'skill' | 'instruction'>('skill');
  const [formDescription, setFormDescription] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formFolderId, setFormFolderId] = useState<number | null>(null);
  const [formScope, setFormScope] = useState<SkillScope>('global');
  const [formInjectionMode, setFormInjectionMode] =
    useState<InstructionDeliveryMode>('always');
  const [formAlwaysModeWarning, setFormAlwaysModeWarning] = useState<
    string | null
  >(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Folder delete confirm
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<number | null>(
    null,
  );

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

  const loadFolders = useCallback(async () => {
    const result = await window.api.listFolders();
    setFolders(result);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  // Listen for live updates from the main process (when agents register skills via tool)
  useEffect(() => {
    const dispose = window.api.onSkillsUpdated(() => {
      void loadEntries();
      void loadFolders();
    });
    return dispose;
  }, [loadEntries, loadFolders]);

  const resetFormFromEntry = useCallback((entry: SkillOrInstruction) => {
    setFormName(entry.name);
    setFormType(entry.type);
    setFormDescription(entry.description);
    setFormContent(entry.content);
    setFormCategory(entry.category ?? '');
    setFormTags(entry.tags?.join(', ') ?? '');
    setFormFolderId(entry.folderId);
    setFormScope(entry.scope);
    setFormInjectionMode(getInstructionDeliveryMode(entry));
    setFormAlwaysModeWarning(entry.alwaysModeWarning ?? null);
  }, []);

  const handleSelect = useCallback(
    (entry: SkillOrInstruction) => {
      setSelected(entry);
      setIsEditing(false);
      setIsCreating(false);
      resetFormFromEntry(entry);
    },
    [resetFormFromEntry],
  );

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
    setFormFolderId(null);
    setFormScope('global');
    setFormInjectionMode('always');
    setFormAlwaysModeWarning(null);
  }, [tab]);

  const handleCreateSkill = useCallback(() => {
    setSelected(null);
    setIsCreating(true);
    setIsEditing(false);
    setFormName('');
    setFormType('skill');
    setFormDescription('');
    setFormContent('');
    setFormCategory('');
    setFormTags('');
    setFormFolderId(null);
    setFormScope('global');
    setFormInjectionMode('always');
    setFormAlwaysModeWarning(null);
  }, []);

  const handleCreateInstruction = useCallback(() => {
    setSelected(null);
    setIsCreating(true);
    setIsEditing(false);
    setFormName('');
    setFormType('instruction');
    setFormDescription('');
    setFormContent('');
    setFormCategory('');
    setFormTags('');
    setFormFolderId(null);
    setFormScope('global');
    setFormInjectionMode('always');
    setFormAlwaysModeWarning(null);
  }, []);

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
      resetFormFromEntry(selected);
    }
    setIsEditing(false);
  }, [isCreating, selected, resetFormFromEntry]);

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
      folderId: formFolderId,
      scope: formScope,
      injectionMode: formType === 'instruction' ? formInjectionMode : undefined,
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
    formFolderId,
    formScope,
    formInjectionMode,
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
        setSelected(duplicated);
        setIsEditing(true);
        setIsCreating(false);
        resetFormFromEntry(duplicated);
      }
    },
    [loadEntries, resetFormFromEntry],
  );

  const handleChangeScope = useCallback(
    async (name: string, scope: SkillScope) => {
      const updated = await window.api.setEntryScope(name, scope);
      if (updated) {
        await loadEntries();
        if (selected?.name === name) setSelected(updated);
      }
    },
    [loadEntries, selected?.name],
  );

  const handleChangeFolder = useCallback(
    async (name: string, folderId: number | null) => {
      const updated = await window.api.setEntryFolder(name, folderId);
      if (updated) {
        await loadEntries();
        if (selected?.name === name) setSelected(updated);
      }
    },
    [loadEntries, selected?.name],
  );

  const handleChangeInjectionMode = useCallback(
    async (name: string, injectionMode: InstructionDeliveryMode) => {
      const updated = await window.api.setEntryInjectionMode(
        name,
        injectionMode,
      );
      if (updated) {
        await loadEntries();
        if (selected?.name === name) setSelected(updated);
      }
    },
    [loadEntries, selected?.name],
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      const created = await window.api.createFolder(name);
      if (created) await loadFolders();
    },
    [loadFolders],
  );

  const handleRenameFolder = useCallback(
    async (id: number, name: string) => {
      const renamed = await window.api.renameFolder(id, name);
      if (renamed) await loadFolders();
    },
    [loadFolders],
  );

  const handleConfirmDeleteFolder = useCallback(async () => {
    if (folderDeleteTarget === null) return;
    const ok = await window.api.deleteFolder(folderDeleteTarget);
    if (ok) {
      await loadFolders();
      await loadEntries();
    }
    setFolderDeleteTarget(null);
  }, [folderDeleteTarget, loadFolders, loadEntries]);

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

  // Collect all unique categories from entries for the filter dropdown
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const e of entries) {
      if (e.category) cats.add(e.category);
    }
    for (const c of PREDEFINED_CATEGORIES) {
      cats.add(c);
    }
    return Array.from(cats).sort();
  }, [entries]);

  // Folder counts (unfiltered so sidebar shows true totals)
  // Derive the visible list from tab + search query + category filter
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (tab !== 'all' && e.type !== tab) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [entries, tab, search, categoryFilter]);

  const unfiledEntries = useMemo(
    () => visibleEntries.filter((e) => e.folderId === null),
    [visibleEntries],
  );

  const entriesByFolder = useMemo(() => {
    const map: Record<number, SkillOrInstruction[]> = {};
    for (const e of visibleEntries) {
      if (e.folderId !== null) {
        (map[e.folderId] ??= []).push(e);
      }
    }
    return map;
  }, [visibleEntries]);

  const hasActiveFilters = Boolean(search.trim() || categoryFilter);

  // Tab counts (reflect current category filter but not search)
  const scopedForTabCounts = useMemo(() => {
    return entries.filter((e) => {
      if (categoryFilter && e.category !== categoryFilter) return false;
      return true;
    });
  }, [entries, categoryFilter]);
  const allCount = scopedForTabCounts.length;
  const skillCount = useMemo(
    () => scopedForTabCounts.filter((e) => e.type === 'skill').length,
    [scopedForTabCounts],
  );
  const instructionCount = useMemo(
    () => scopedForTabCounts.filter((e) => e.type === 'instruction').length,
    [scopedForTabCounts],
  );

  return (
    <div className="flex h-full overflow-hidden">
      <SkillsSidebar
        tab={tab}
        setTab={setTab}
        search={search}
        setSearch={setSearch}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        availableCategories={availableCategories}
        unfiledEntries={unfiledEntries}
        entriesByFolder={entriesByFolder}
        allCount={allCount}
        skillCount={skillCount}
        instructionCount={instructionCount}
        selected={selected}
        exportStatus={exportStatus}
        onExport={() => void handleExport()}
        onCreate={handleCreate}
        onCreateSkill={handleCreateSkill}
        onCreateInstruction={handleCreateInstruction}
        onSelect={handleSelect}
        onDelete={(name) => setDeleteTarget(name)}
        onToggleEnabled={handleToggleEnabled}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={(id) => setFolderDeleteTarget(id)}
        onMoveEntry={(name, folderId) =>
          void handleChangeFolder(name, folderId)
        }
        hasActiveFilters={hasActiveFilters}
      />

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-[var(--color-bg)]">
        {!selected ? (
          <SkillsEmptyState />
        ) : (
          <div className="max-w-3xl space-y-6">
            <SkillDetailView
              selected={selected}
              folders={folders}
              singleExportStatus={singleExportStatus}
              onToggleEnabled={handleToggleEnabled}
              onExportSingle={(name) => void handleExportSingle(name)}
              onDuplicate={(name) => void handleDuplicate(name)}
              onEdit={handleEdit}
              onDelete={(name) => setDeleteTarget(name)}
              onChangeScope={(name, scope) =>
                void handleChangeScope(name, scope)
              }
              onChangeInjectionMode={(name, injectionMode) =>
                void handleChangeInjectionMode(name, injectionMode)
              }
              onChangeFolder={(name, folderId) =>
                void handleChangeFolder(name, folderId)
              }
            />
          </div>
        )}
      </div>

      <SkillEditor
        open={isCreating || isEditing}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
        isCreating={isCreating}
        selected={selected}
        formName={formName}
        setFormName={setFormName}
        formType={formType}
        setFormType={setFormType}
        formCategory={formCategory}
        setFormCategory={setFormCategory}
        formTags={formTags}
        setFormTags={setFormTags}
        formDescription={formDescription}
        setFormDescription={setFormDescription}
        formContent={formContent}
        setFormContent={setFormContent}
        formFolderId={formFolderId}
        setFormFolderId={setFormFolderId}
        formScope={formScope}
        setFormScope={setFormScope}
        formInjectionMode={formInjectionMode}
        setFormInjectionMode={setFormInjectionMode}
        alwaysModeWarning={formAlwaysModeWarning}
        folders={folders}
        availableCategories={availableCategories}
        saveStatus={saveStatus}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        label={deleteTarget ?? ''}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={folderDeleteTarget !== null}
        title="Delete folder?"
        description="Entries in this folder will be unfiled. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleConfirmDeleteFolder()}
        onCancel={() => setFolderDeleteTarget(null)}
      />
    </div>
  );
}
