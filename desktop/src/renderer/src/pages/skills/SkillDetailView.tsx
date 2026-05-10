import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  getAlwaysModeWarning,
  getInstructionDeliveryMode,
  shouldShowInstructionDeliveryControl,
} from './instruction-delivery';
import type {
  Folder,
  InstructionDeliveryMode,
  SkillOrInstruction,
  SkillScope,
} from './skills-types';

type SkillDetailViewProps = {
  selected: SkillOrInstruction;
  folders: Folder[];
  singleExportStatus: string | null;
  onToggleEnabled: (name: string, currentEnabled: boolean) => void;
  onExportSingle: (name: string) => void;
  onDuplicate: (name: string) => void;
  onEdit: () => void;
  onDelete: (name: string) => void;
  onChangeScope: (name: string, scope: SkillScope) => void;
  onChangeInjectionMode: (
    name: string,
    injectionMode: InstructionDeliveryMode,
  ) => void;
  onChangeFolder: (name: string, folderId: number | null) => void;
};

export function SkillDetailView({
  selected,
  folders,
  singleExportStatus,
  onToggleEnabled,
  onExportSingle,
  onDuplicate,
  onEdit,
  onDelete,
  onChangeScope,
  onChangeInjectionMode,
  onChangeFolder,
}: SkillDetailViewProps): React.ReactElement {
  const currentFolder = folders.find((f) => f.id === selected.folderId);
  const showInstructionDelivery = shouldShowInstructionDeliveryControl(
    selected.type,
  );
  const deliveryMode = getInstructionDeliveryMode(selected);
  const alwaysModeWarning = getAlwaysModeWarning(selected);

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-foreground">
          {selected.name}
        </h3>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2 items-center">
            {/* Toggle switch */}
            <Switch
              checked={selected.enabled}
              onCheckedChange={() =>
                onToggleEnabled(selected.name, selected.enabled)
              }
              aria-label={
                selected.enabled ? 'Disable this entry' : 'Enable this entry'
              }
            />
            <span className="text-[10px] text-muted-foreground w-14">
              {selected.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDuplicate(selected.name)}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onExportSingle(selected.name)}
            >
              Export
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onDelete(selected.name)}
            >
              Delete
            </Button>
          </div>

          {/* Quick scope + folder controls */}
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Scope</span>
              <select
                value={selected.scope}
                onChange={(e) =>
                  onChangeScope(selected.name, e.target.value as SkillScope)
                }
                className="bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <option value="global">Global</option>
                <option value="session-scoped">Session-scoped</option>
              </select>
            </label>
            {showInstructionDelivery && (
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>Delivery</span>
                <select
                  value={deliveryMode}
                  onChange={(e) =>
                    onChangeInjectionMode(
                      selected.name,
                      e.target.value as InstructionDeliveryMode,
                    )
                  }
                  className="bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-1.5 py-0.5 text-[10px] text-foreground"
                >
                  <option value="always">Always</option>
                  <option value="catalog">Catalog</option>
                </select>
              </label>
            )}
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Folder</span>
              <select
                value={
                  selected.folderId === null ? '' : String(selected.folderId)
                }
                onChange={(e) =>
                  onChangeFolder(
                    selected.name,
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                className="bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <option value="">(Unfiled)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={String(folder.id)}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {alwaysModeWarning && (
            <p className="text-[10px] text-destructive">{alwaysModeWarning}</p>
          )}

          {singleExportStatus && (
            <span className="text-[10px] text-muted-foreground">
              {singleExportStatus}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={selected.type === 'skill' ? 'default' : 'secondary'}>
            {selected.type}
          </Badge>
          <Badge
            variant={
              selected.scope === 'session-scoped' ? 'secondary' : 'outline'
            }
            title={
              selected.scope === 'session-scoped'
                ? 'Only injected into channels that opt in'
                : 'Always injected into agent sessions'
            }
          >
            {selected.scope === 'session-scoped' ? 'Session-scoped' : 'Global'}
          </Badge>
          {showInstructionDelivery && (
            <Badge
              variant={deliveryMode === 'always' ? 'outline' : 'secondary'}
              title={
                deliveryMode === 'always'
                  ? 'Instruction content is delivered with every session injection'
                  : 'Instruction is shown in the catalog and loaded on demand'
              }
            >
              {deliveryMode === 'always' ? 'Always' : 'Catalog'}
            </Badge>
          )}
          {currentFolder && (
            <Badge variant="outline">📁 {currentFolder.name}</Badge>
          )}
          {selected.category && (
            <Badge variant="secondary">{selected.category}</Badge>
          )}
          {selected.tags &&
            selected.tags.length > 0 &&
            selected.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          <span className="text-xs text-muted-foreground">
            Updated {selected.updatedAt}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">{selected.description}</p>

        <div className="border-t border-border pt-3">
          <pre className="text-xs leading-relaxed text-foreground bg-[var(--color-input-bg)] border border-border rounded-sm p-3 overflow-x-auto whitespace-pre-wrap">
            {selected.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
