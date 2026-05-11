import { memo } from 'react';
import { Sparkles, FileText, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SkillsActionBarProps = {
  onCreateSkill: () => void;
  onCreateInstruction: () => void;
  onCreateFolder: () => void;
};

export const SkillsActionBar = memo(function SkillsActionBar({
  onCreateSkill,
  onCreateInstruction,
  onCreateFolder,
}: SkillsActionBarProps): React.ReactElement {
  return (
    <div className="flex h-[30px] shrink-0 items-center gap-0.5 px-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
        onClick={onCreateSkill}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Skill
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
        onClick={onCreateInstruction}
      >
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        Instruction
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
        onClick={onCreateFolder}
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Folder
      </Button>
    </div>
  );
});
