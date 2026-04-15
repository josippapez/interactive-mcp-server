import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type SkillEditorProps = {
  isCreating: boolean;
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
  availableCategories: string[];
  saveStatus: string | null;
  onSave: () => void;
  onCancel: () => void;
};

export function SkillEditor({
  isCreating,
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
  availableCategories,
  saveStatus,
  onSave,
  onCancel,
}: SkillEditorProps): React.ReactElement {
  const isEditing = !isCreating;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
          Name
        </label>
        <Input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g. code-review, typescript-rules"
          disabled={isEditing}
        />
        {isEditing && (
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
        <Input
          type="text"
          list="category-options"
          value={formCategory}
          onChange={(e) => setFormCategory(e.target.value)}
          placeholder="Select or type a category"
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
        <Input
          type="text"
          value={formTags}
          onChange={(e) => setFormTags(e.target.value)}
          placeholder="Comma-separated tags, e.g. react, typescript, testing"
        />
      </div>

      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
          Description
        </label>
        <Input
          type="text"
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          placeholder="Short summary of what this does"
        />
      </div>

      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
          Content (Markdown)
        </label>
        <Textarea
          value={formContent}
          onChange={(e) => setFormContent(e.target.value)}
          placeholder="Full content body — supports Markdown"
          rows={16}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          className="px-3 py-1.5 text-xs rounded-sm bg-[var(--color-agent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
        >
          {isCreating ? 'Create' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
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
  );
}
