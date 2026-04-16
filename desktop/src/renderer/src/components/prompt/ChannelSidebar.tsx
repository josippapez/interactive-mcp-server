import { memo } from 'react';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { ProjectsSection } from './sidebar/ProjectsSection';
import { DirectConnectionsSection } from './sidebar/DirectConnectionsSection';
import { ProjectRail } from './sidebar/ProjectRail';
import { useSidebarState } from './sidebar/useSidebarState';
import { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from './sidebar/types';

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
  const {
    sidebarRef,
    filter,
    setFilter,
    showInactive,
    collapsedProjects,
    collapsedSessions,
    sidebarWidth,
    isResizing,
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
    handleMouseDown,
    handleSelectProject,
  } = useSidebarState({ activeConnectionId });

  return (
    <div className="flex h-full">
      {/* Project Rail - far left */}
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

      {/* Main sidebar content */}
      <aside
        ref={sidebarRef}
        style={{ width: sidebarWidth }}
        className="relative border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-hidden flex flex-col shrink-0"
      >
        <SidebarHeader
          filter={filter}
          onFilterChange={setFilter}
          providerTabs={providerTabs}
          providerCounts={providerCounts}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
        />

        {/* Sessions list */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <ProjectsSection
            projects={filteredProjects}
            filter={filter}
            showInactive={showInactive}
            runningCount={runningCount}
            inactiveCount={inactiveCount}
            onToggleInactive={handleToggleInactive}
            collapsedProjects={collapsedProjects}
            onToggleProject={handleToggleProject}
            onRemoveProject={handleRemoveProject}
            activeConnectionId={activeConnectionId}
            onSelect={onSelect}
            getStatus={getStatus}
            onCreateSession={onCreateSession}
            collapsedSessions={collapsedSessions}
            onToggleSession={handleToggleSession}
            onAddProject={handleAddProject}
            hasDirectConnections={filteredDirectConnections.length > 0}
            selectedProjectPath={selectedProjectPath}
          />

          <DirectConnectionsSection
            connections={filteredDirectConnections}
            activeConnectionId={activeConnectionId}
            onSelect={onSelect}
          />
        </div>

        {/* Resize handle */}
        <div
          role="slider"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          tabIndex={0}
          onMouseDown={handleMouseDown}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--color-agent)]/30 transition-colors ${
            isResizing ? 'bg-[var(--color-agent)]/50' : ''
          }`}
        />
      </aside>
    </div>
  );
});

export default ChannelSidebar;
