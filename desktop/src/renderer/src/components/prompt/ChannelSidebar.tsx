import { memo, useEffect, useRef, useState } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader as ShadcnSidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { SidebarHeader as ChannelFilterBar } from './sidebar/SidebarHeader';
import { ProjectsSection } from './sidebar/ProjectsSection';
import { DirectConnectionsSection } from './sidebar/DirectConnectionsSection';
import { ProjectRail } from './sidebar/ProjectRail';
import { useSidebarState } from './sidebar/useSidebarState';
import {
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from './sidebar/sidebar-resize';

type Props = {
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
  /** Called when user wants to create a new session for a project */
  onCreateSession?: (baseDirectory: string) => void;
  /** Switch to the most relevant session for a selected project */
  onSelectProjectSession?: (projectPath: string | null) => void;
};

const ChannelSidebar = memo(function ChannelSidebar({
  activeConnectionId,
  onSelect,
  onCreateSession,
  onSelectProjectSession,
}: Props): React.ReactElement {
  const { open, isMobile } = useSidebar();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 280;

    try {
      return parseStoredSidebarWidth(
        window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
      );
    } catch {
      return 280;
    }
  });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const {
    filter,
    setFilter,
    showInactive,
    collapsedProjects,
    collapsedSessions,
    isRefreshing,
    selectedProjectPath,
    filteredProjects,
    allProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
    inactiveCount,
    getStatus,
    handleRefresh,
    handleToggleInactive,
    handleToggleProject,
    handleToggleSession,
    handleAddProject,
    handleRemoveProject,
    handleSelectProject,
  } = useSidebarState({ activeConnectionId });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_WIDTH_STORAGE_KEY,
        String(sidebarWidth),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (isMobile) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const nextWidth = clampSidebarWidth(
        dragState.startWidth + (event.clientX - dragState.startX),
      );
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragStateRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isMobile]);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (isMobile || !open) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    document.body.style.setProperty('cursor', 'col-resize');
    document.body.style.setProperty('user-select', 'none');
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div className="relative flex h-full min-h-0" data-sidebar-shell>
      {/* Project Rail - far left, independent column (matches opencode layout) */}
      <ProjectRail
        projects={allProjects}
        selectedPath={selectedProjectPath}
        onSelect={(path) => {
          handleSelectProject(path);
          onSelectProjectSession?.(path);
        }}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
      />

      {/* Channel list sidebar — shadcn primitive with collapsible="none" so it
          stays inline with the flex layout (the outer SidebarProvider still
          supplies context + the Ctrl/Cmd+B toggle for future use). */}
      <Sidebar
        collapsible="none"
        style={
          { '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties
        }
        className={cn(
          'h-full border-r border-[var(--color-border)] bg-[var(--color-surface-alt)]/90 transition-[width,opacity,border-color] duration-200',
          !open && !isMobile && 'w-0 border-r-0 opacity-0 pointer-events-none',
        )}
      >
        <ShadcnSidebarHeader className="p-0 gap-0">
          <ChannelFilterBar
            filter={filter}
            onFilterChange={setFilter}
            providerTabs={providerTabs}
            providerCounts={providerCounts}
            showInactive={showInactive}
            inactiveCount={inactiveCount}
            onToggleInactive={handleToggleInactive}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
        </ShadcnSidebarHeader>

        <SidebarContent className="gap-0 overflow-hidden">
          <ScrollArea className="min-h-0 flex-1">
            <div className="min-w-0 pb-3 pt-1">
              <ProjectsSection
                projects={filteredProjects}
                filter={filter}
                runningCount={runningCount}
                collapsedProjects={collapsedProjects}
                onToggleProject={handleToggleProject}
                onRemoveProject={handleRemoveProject}
                activeConnectionId={activeConnectionId}
                onSelect={onSelect}
                getStatus={getStatus}
                onCreateSession={onCreateSession}
                collapsedSessions={collapsedSessions}
                onToggleSession={handleToggleSession}
                hasDirectConnections={filteredDirectConnections.length > 0}
                selectedProjectPath={selectedProjectPath}
              />

              <DirectConnectionsSection
                connections={filteredDirectConnections}
                activeConnectionId={activeConnectionId}
                onSelect={onSelect}
              />
            </div>
          </ScrollArea>
        </SidebarContent>
      </Sidebar>

      {open && !isMobile && (
        <button
          type="button"
          aria-label="Resize sidebar"
          title="Drag to resize sidebar"
          onPointerDown={handleResizeStart}
          className="absolute top-0 right-0 z-20 hidden h-full w-3 translate-x-1/2 cursor-col-resize md:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-[var(--color-agent)]/45" />
        </button>
      )}
    </div>
  );
});

export default ChannelSidebar;
