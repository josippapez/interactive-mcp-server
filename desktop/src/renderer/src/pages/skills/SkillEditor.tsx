import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  getAlwaysModeWarning,
  shouldShowInstructionDeliveryControl,
} from './instruction-delivery';
import type {
  Folder,
  InstructionDeliveryMode,
  SkillOrInstruction,
  SkillScope,
} from './skills-types';

type SkillEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCreating: boolean;
  selected: SkillOrInstruction | null;
  formName: string;
  setFormName: (name: string) => void;
  formType: 'skill' | 'instruction';
  setFormType: (type: 'skill' | 'instruction') => void;
  formCategory: string;
  setFormCategory: (category: string) => void;
  formTags: string;
  setFormTags: (tags: string) => void;
  formDescription: string;
  setFormDescription: (description: string) => void;
  formContent: string;
  setFormContent: (content: string) => void;
  formFolderId: number | null;
  setFormFolderId: (id: number | null) => void;
  formScope: SkillScope;
  setFormScope: (scope: SkillScope) => void;
  formInjectionMode: InstructionDeliveryMode;
  setFormInjectionMode: (mode: InstructionDeliveryMode) => void;
  alwaysModeWarning: string | null;
  folders: Folder[];
  availableCategories: string[];
  saveStatus: string | null;
  onSave: () => void;
  onCancel: () => void;
};

function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string }[];
  ariaLabel: string;
}): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full items-center rounded-md border bg-muted p-[3px] text-muted-foreground"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.description}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SkillEditor({
  open,
  onOpenChange,
  isCreating,
  selected,
  formName,
  setFormName,
  formType,
  setFormType,
  formCategory,
  setFormCategory,
  formTags,
  setFormTags,
  formDescription,
  setFormDescription,
  formContent,
  setFormContent,
  formFolderId,
  setFormFolderId,
  formScope,
  setFormScope,
  formInjectionMode,
  setFormInjectionMode,
  alwaysModeWarning,
  folders,
  availableCategories,
  saveStatus,
  onSave,
  onCancel,
}: SkillEditorProps): React.ReactElement {
  const isEditing = !isCreating;
  const showInstructionDelivery =
    shouldShowInstructionDeliveryControl(formType);
  const visibleAlwaysModeWarning = getAlwaysModeWarning({
    type: formType,
    injectionMode: formInjectionMode,
    alwaysModeWarning,
  });

  const sheetTitle = isCreating
    ? formType === 'instruction'
      ? 'Create new instruction'
      : 'Create new skill'
    : `Edit ${selected?.name ?? ''}`;

  const sheetDescription = isCreating
    ? 'Add a reusable skill or instruction. Markdown is supported in the content body.'
    : 'Update this entry. The name cannot be changed after creation.';

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) onCancel();
      }}
    >
      <SheetContent
        side="right"
        className="sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription>{sheetDescription}</SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          onKeyDown={handleKeyDown}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  type="text"
                  value={formName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormName(e.target.value)
                  }
                  placeholder="e.g. code-review, typescript-rules"
                  disabled={isEditing}
                />
                {isEditing && (
                  <p className="text-xs text-muted-foreground">
                    Name cannot be changed after creation.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Type</Label>
                <Tabs
                  value={formType}
                  onValueChange={(val: string) =>
                    setFormType(val as 'skill' | 'instruction')
                  }
                >
                  <TabsList>
                    <TabsTrigger value="skill" disabled={isEditing}>
                      Skill
                    </TabsTrigger>
                    <TabsTrigger value="instruction" disabled={isEditing}>
                      Instruction
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="skill-folder">Folder</Label>
                <Select
                  value={
                    formFolderId === null ? '__none__' : String(formFolderId)
                  }
                  onValueChange={(val: string) =>
                    setFormFolderId(val === '__none__' ? null : Number(val))
                  }
                >
                  <SelectTrigger id="skill-folder" className="w-full">
                    <SelectValue placeholder="(Unfiled)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(Unfiled)</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={String(folder.id)}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="skill-category">Category</Label>
                <Input
                  id="skill-category"
                  type="text"
                  list="category-options"
                  value={formCategory}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormCategory(e.target.value)
                  }
                  placeholder="Select or type a category"
                />
                <datalist id="category-options">
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-description">Description</Label>
              <Textarea
                id="skill-description"
                value={formDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormDescription(e.target.value)
                }
                placeholder="Short summary of what this does"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-content">Content (Markdown)</Label>
              <Textarea
                id="skill-content"
                value={formContent}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormContent(e.target.value)
                }
                placeholder="Full content body — supports Markdown"
                rows={16}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Tip: press Cmd/Ctrl+Enter to save.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-tags">Tags</Label>
              <Input
                id="skill-tags"
                type="text"
                value={formTags}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormTags(e.target.value)
                }
                placeholder="react, typescript, testing"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Used for search and filtering.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Scope</Label>
              <SegmentedToggle<SkillScope>
                value={formScope}
                onChange={setFormScope}
                ariaLabel="Scope"
                options={[
                  {
                    value: 'global',
                    label: 'Global',
                    description: 'Always injected into agent sessions',
                  },
                  {
                    value: 'session-scoped',
                    label: 'Session-scoped',
                    description: 'Only injected into channels that opt in',
                  },
                ]}
              />
            </div>

            {showInstructionDelivery && (
              <div className="space-y-1.5">
                <Label>Delivery</Label>
                <SegmentedToggle<InstructionDeliveryMode>
                  value={formInjectionMode}
                  onChange={setFormInjectionMode}
                  ariaLabel="Delivery"
                  options={[
                    {
                      value: 'always',
                      label: 'Always',
                      description:
                        'Instruction content is delivered with every session injection',
                    },
                    {
                      value: 'catalog',
                      label: 'Catalog only',
                      description:
                        'Instruction is shown in the catalog and loaded on demand',
                    },
                  ]}
                />
                {visibleAlwaysModeWarning && (
                  <p className="text-xs text-destructive">
                    {visibleAlwaysModeWarning}
                  </p>
                )}
              </div>
            )}
          </div>

          <SheetFooter className="border-t px-6 py-3 flex-row items-center justify-end gap-2">
            {saveStatus && (
              <span className="mr-auto text-xs text-muted-foreground">
                {saveStatus}
              </span>
            )}
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{isCreating ? 'Create' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
