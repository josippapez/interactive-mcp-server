import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SkillsEmptyStateProps = {
  /** Optional CTA action shown when provided. */
  onCreate?: () => void;
};

export function SkillsEmptyState({
  onCreate,
}: SkillsEmptyStateProps): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="bg-accent text-accent-foreground mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-foreground text-base font-semibold">
          Select a skill or instruction
        </h3>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Pick an entry from the sidebar to view or edit it. Skills and
          instructions are injected into agent sessions automatically.
        </p>
        <p className="text-muted-foreground/80 mt-1 text-xs">
          Agents can also manage them via the
          <code className="bg-muted text-foreground mx-1 rounded px-1 py-0.5 text-[11px]">
            manage_skills_and_instructions
          </code>
          tool.
        </p>
        {onCreate && (
          <Button type="button" onClick={onCreate} className="mt-5" size="sm">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Create your first skill
          </Button>
        )}
      </div>
    </div>
  );
}
