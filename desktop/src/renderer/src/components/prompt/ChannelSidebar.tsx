import { memo, useEffect, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  FolderPlus,
  Search,
  LayoutGrid,
  Settings as SettingsIcon,
  PanelLeftClose,
  Layers,
  Sun,
  Moon,
} from 'lucide-react';
import { useTheme } from '../../ThemeContext';
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
  /** Active top-level app tab — drives nav-row active state */
  activeTab?: 'prompt' | 'skills' | 'settings';
  /** Switch top-level app tab (Hub / Settings nav rows) */
  onNavigate?: (tab: 'prompt' | 'skills' | 'settings') => void;
  /** Click handler for the "New chat" nav row */
  onNewChat?: () => void;
  /** Click handler for the "Search" nav row (opens QuickSwitcher) */
  onOpenSearch?: () => void;
};

type NavRowProps = {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick?: () => void;
};

function NavRow({
  icon,
  label,
  shortcut,
  active,
  onClick,
}: NavRowProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('nav-row', active && 'nav-row-active')}
      aria-pressed={active ? 'true' : undefined}
    >
      <span className="nav-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-row-label">{label}</span>
      {shortcut && <span className="nav-row-shortcut">{shortcut}</span>}
    </button>
  );
}

const ChannelSidebar = memo(function ChannelSidebar({
  activeConnectionId,
  onSelect,
  onCreateSession,
  activeTab,
  onNavigate,
  onNewChat,
  onOpenSearch,
}: Props): React.ReactElement {
  const { open, isMobile, setOpen } = useSidebar();
  const { theme, toggle: toggleTheme } = useTheme();
  const [showProjectRail, setShowProjectRail] = useState<boolean>(false);
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
    handlePinProject,
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

  const handleHubClick = onNavigate
    ? () => onNavigate(activeTab === 'skills' ? 'prompt' : 'skills')
    : undefined;
  const handleSettingsClick = onNavigate
    ? () => onNavigate(activeTab === 'settings' ? 'prompt' : 'settings')
    : undefined;

  return (
    <div className="relative flex h-full min-h-0" data-sidebar-shell>
      {/* Project Rail - hidden by default; toggled via the bottom button. */}
      {showProjectRail && (
        <ProjectRail
          projects={allProjects}
          selectedPath={selectedProjectPath}
          onSelect={(path) => {
            handleSelectProject(path);
          }}
          onAddProject={handleAddProject}
          onPinProject={handlePinProject}
          onRemoveProject={handleRemoveProject}
        />
      )}

      {/* Channel list sidebar with the new sky-blue gradient surface. */}
      <Sidebar
        collapsible="none"
        style={
          { '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties
        }
        className={cn(
          'sidebar-surface h-full border-r border-[var(--color-border-weak)] transition-[width,opacity,border-color] duration-200',
          !open && !isMobile && 'w-0 border-r-0 opacity-0 pointer-events-none',
        )}
      >
        <ShadcnSidebarHeader className="p-0 gap-0">
          {/*
            Top-right collapse toggle. The row itself is `titlebar-drag` so
            empty pixels in the sidebar's top strip act as a window drag
            handle. The button is wrapped in `titlebar-no-drag` so it remains
            clickable. Standard Electron pattern (drag on parent, no-drag on
            interactive child).
          */}
          <div className="titlebar-drag flex items-center justify-end px-2 pt-2">
            <div className="titlebar-no-drag">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] hover:text-[var(--color-text-muted)]"
              >
                <PanelLeftClose
                  width={14}
                  height={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          {/* Top action group — chunky pill nav rows */}
          <nav
            className="flex flex-col gap-0.5 px-2 pt-1 pb-2"
            aria-label="Primary"
          >
            <NavRow
              icon={
                <MessageSquarePlus width={16} height={16} strokeWidth={1.75} />
              }
              label="New chat"
              shortcut="⌘N"
              onClick={onNewChat}
            />
            <NavRow
              icon={<FolderPlus width={16} height={16} strokeWidth={1.75} />}
              label="New project"
              shortcut="⌘P"
              onClick={handleAddProject}
            />
            <NavRow
              icon={<Search width={16} height={16} strokeWidth={1.75} />}
              label="Search"
              shortcut="⌘K"
              onClick={onOpenSearch}
            />
            <NavRow
              icon={<LayoutGrid width={16} height={16} strokeWidth={1.75} />}
              label="Skills"
              active={activeTab === 'skills'}
              onClick={handleHubClick}
            />
            <NavRow
              icon={<SettingsIcon width={16} height={16} strokeWidth={1.75} />}
              label="Settings"
              active={activeTab === 'settings'}
              onClick={handleSettingsClick}
            />
          </nav>

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
          <ScrollArea className="min-h-0 w-full flex-1 overflow-hidden [&_[role=presentation]]:!min-w-0 [&_[role=presentation]]:!w-full">
            <div className="w-full min-w-0 pb-3 pt-1">
              <ProjectsSection
                projects={filteredProjects}
                filter={filter}
                runningCount={runningCount}
                collapsedProjects={collapsedProjects}
                onToggleProject={handleToggleProject}
                onPinProject={handlePinProject}
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

          {/* Footer: theme switch + project-rail toggle */}
          <div className="flex items-center gap-1 border-t border-[var(--color-border-weak)] px-2 py-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-center rounded-md px-1.5 py-1 text-[var(--color-text-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text-muted)]"
              title={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
              aria-label={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
            >
              <span aria-hidden="true">
                {theme === 'dark' ? (
                  <Sun width={12} height={12} strokeWidth={1.75} />
                ) : (
                  <Moon width={12} height={12} strokeWidth={1.75} />
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowProjectRail((prev) => !prev)}
              className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-[11px] text-[var(--color-text-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text-muted)]"
              title={
                showProjectRail ? 'Hide project rail' : 'Show project rail'
              }
            >
              <Layers
                width={12}
                height={12}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                {showProjectRail ? 'Hide project rail' : 'Show project rail'}
              </span>
            </button>
          </div>
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
