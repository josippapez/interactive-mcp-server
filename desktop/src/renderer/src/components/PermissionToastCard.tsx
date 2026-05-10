import { AlertTriangle } from 'lucide-react';
import type { PendingPermission } from '../types';
import { getPermissionDisplay } from './permission-display';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type Props = {
  perm: PendingPermission;
  sessionTitle: string;
  nodeId: string;
  onAllowOnce: () => void;
  onAlways: () => void;
  onReject: () => void;
  onGoToSession: (id: string) => void;
};

/**
 * Card body rendered inside `toast.custom(...)` for a single pending
 * permission request. Stateless; all interactions are passed in as props.
 */
export default function PermissionToastCard({
  perm,
  sessionTitle,
  nodeId,
  onAllowOnce,
  onAlways,
  onReject,
  onGoToSession,
}: Props): React.ReactElement {
  const truncatedTitle =
    sessionTitle.length > 24 ? `${sessionTitle.slice(0, 24)}…` : sessionTitle;
  const display = getPermissionDisplay(perm);

  return (
    <div className="w-[380px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-amber-500/10">
        <AlertTriangle
          className="size-4 text-amber-500 shrink-0"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold flex-1">Permission Request</span>
        <button
          type="button"
          onClick={() => onGoToSession(nodeId)}
          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline truncate max-w-[120px]"
          title={sessionTitle}
        >
          {truncatedTitle}
        </button>
      </div>

      <div className="px-3 py-2">
        <p className="text-sm break-words flex items-start gap-1.5">
          <span className="font-mono text-muted-foreground shrink-0">
            {display.icon}
          </span>
          <span className="text-foreground font-medium">{display.title}</span>
        </p>
        {display.detail && (
          <p className="mt-1 text-xs text-muted-foreground break-all font-mono">
            {display.detail}
          </p>
        )}
        {perm.patterns && perm.patterns.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {perm.patterns.slice(0, 3).map((pattern) => (
              <Badge
                key={pattern}
                variant="outline"
                className="font-mono text-[10px] max-w-[260px] truncate"
                title={pattern}
              >
                {pattern}
              </Badge>
            ))}
            {perm.patterns.length > 3 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{perm.patterns.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-t border-border">
        <Button size="sm" onClick={onAllowOnce}>
          Allow Once
        </Button>
        {perm.always && (
          <Button variant="outline" size="sm" onClick={onAlways}>
            Always
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReject}
          className="ml-auto hover:text-destructive"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
