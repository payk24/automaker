"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import { useSetupStore } from "@/store/setup-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings,
  Key,
  Keyboard,
  Trash2,
  Folder,
  Terminal,
  Atom,
  Palette,
  LayoutGrid,
  Settings2,
  FlaskConical,
} from "lucide-react";
import { getElectronAPI } from "@/lib/electron";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyboardMap, ShortcutReferencePanel } from "@/components/ui/keyboard-map";
// Import custom hooks
import { useCliStatus } from "./settings-view/hooks/use-cli-status";
// Import extracted sections
import { ApiKeysSection } from "./settings-view/api-keys/api-keys-section";
import { ClaudeCliStatus } from "./settings-view/cli-status/claude-cli-status";
import { CodexCliStatus } from "./settings-view/cli-status/codex-cli-status";
import { AppearanceSection } from "./settings-view/appearance/appearance-section";
import { KanbanDisplaySection } from "./settings-view/kanban-display/kanban-display-section";
import { KeyboardShortcutsSection } from "./settings-view/keyboard-shortcuts/keyboard-shortcuts-section";
import { FeatureDefaultsSection } from "./settings-view/feature-defaults/feature-defaults-section";
import { DangerZoneSection } from "./settings-view/danger-zone/danger-zone-section";

// Navigation items for the side panel
const NAV_ITEMS = [
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "claude", label: "Claude", icon: Terminal },
  { id: "codex", label: "Codex", icon: Atom },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "kanban", label: "Kanban Display", icon: LayoutGrid },
  { id: "keyboard", label: "Keyboard Shortcuts", icon: Settings2 },
  { id: "defaults", label: "Feature Defaults", icon: FlaskConical },
  { id: "danger", label: "Danger Zone", icon: Trash2 },
];

export function SettingsView() {
  const {
    setCurrentView,
    theme,
    setTheme,
    setProjectTheme,
    kanbanCardDetailLevel,
    setKanbanCardDetailLevel,
    defaultSkipTests,
    setDefaultSkipTests,
    useWorktrees,
    setUseWorktrees,
    showProfilesOnly,
    setShowProfilesOnly,
    currentProject,
    moveProjectToTrash,
  } = useAppStore();

  const { claudeAuthStatus, codexAuthStatus, setClaudeAuthStatus, setCodexAuthStatus } =
    useSetupStore();

  // Compute the effective theme for the current project
  const effectiveTheme = currentProject?.theme || theme;

  // Handler to set theme - saves to project if one is selected, otherwise to global
  const handleSetTheme = (newTheme: typeof theme) => {
    if (currentProject) {
      setProjectTheme(currentProject.id, newTheme);
    } else {
      setTheme(newTheme);
    }
  };

  // Use CLI status hook
  const {
    claudeCliStatus,
    codexCliStatus,
    isCheckingClaudeCli,
    isCheckingCodexCli,
    handleRefreshClaudeCli,
    handleRefreshCodexCli,
  } = useCliStatus();

  const [activeSection, setActiveSection] = useState("api-keys");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showKeyboardMapDialog, setShowKeyboardMapDialog] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Track scroll position to highlight active nav item
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const sections = NAV_ITEMS.filter(
        (item) => item.id !== "danger" || currentProject
      )
        .map((item) => ({
          id: item.id,
          element: document.getElementById(item.id),
        }))
        .filter((s) => s.element);

      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      // Check if scrolled to bottom (within a small threshold)
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 50;

      if (isAtBottom && sections.length > 0) {
        // If at bottom, highlight the last visible section
        setActiveSection(sections[sections.length - 1].id);
        return;
      }

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.element) {
          const rect = section.element.getBoundingClientRect();
          const relativeTop = rect.top - containerRect.top + scrollTop;
          if (scrollTop >= relativeTop - 100) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [currentProject]);

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const relativeTop =
        elementRect.top - containerRect.top + container.scrollTop;

      container.scrollTo({
        top: relativeTop - 24,
        behavior: "smooth",
      });
    }
  }, []);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden content-bg"
      data-testid="settings-view"
    >
      {/* Header Section */}
      <div className="shrink-0 border-b border-border bg-glass backdrop-blur-md">
        <div className="px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-linear-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/20 flex items-center justify-center">
              <Settings className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure your API keys and preferences
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sticky Side Navigation */}
        <nav className="hidden lg:block w-48 shrink-0 border-r border-border bg-card/50 backdrop-blur-sm">
          <div className="sticky top-0 p-4 space-y-1">
            {NAV_ITEMS.filter(
              (item) => item.id !== "danger" || currentProject
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left",
                    isActive
                      ? "bg-brand-500/10 text-brand-500 border border-brand-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0",
                      isActive ? "text-brand-500" : ""
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Scrollable Content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto space-y-6 pb-96">
            {/* API Keys Section */}
            <ApiKeysSection />

            {/* Claude CLI Status Section */}
            {claudeCliStatus && (
              <ClaudeCliStatus
                status={claudeCliStatus}
                isChecking={isCheckingClaudeCli}
                onRefresh={handleRefreshClaudeCli}
              />
            )}

            {/* Codex CLI Status Section */}
            {codexCliStatus && (
              <CodexCliStatus
                status={codexCliStatus}
                isChecking={isCheckingCodexCli}
                onRefresh={handleRefreshCodexCli}
              />
            )}

            {/* Appearance Section */}
            <AppearanceSection
              effectiveTheme={effectiveTheme}
              currentProject={currentProject}
              onThemeChange={handleSetTheme}
            />

            {/* Kanban Card Display Section */}
            <KanbanDisplaySection
              detailLevel={kanbanCardDetailLevel}
              onChange={setKanbanCardDetailLevel}
            />

            {/* Keyboard Shortcuts Section */}
            <KeyboardShortcutsSection
              onOpenKeyboardMap={() => setShowKeyboardMapDialog(true)}
            />

            {/* Feature Defaults Section */}
            <FeatureDefaultsSection
              showProfilesOnly={showProfilesOnly}
              defaultSkipTests={defaultSkipTests}
              useWorktrees={useWorktrees}
              onShowProfilesOnlyChange={setShowProfilesOnly}
              onDefaultSkipTestsChange={setDefaultSkipTests}
              onUseWorktreesChange={setUseWorktrees}
            />

            {/* Danger Zone Section - Only show when a project is selected */}
            <DangerZoneSection
              project={currentProject}
              onDeleteClick={() => setShowDeleteDialog(true)}
            />

            {/* Save Button */}
            <div className="flex items-center gap-4">
              <Button
                variant="secondary"
                onClick={() => setCurrentView("welcome")}
                className="bg-secondary hover:bg-accent text-secondary-foreground border border-border"
                data-testid="back-to-home"
              >
                Back to Home
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Map Dialog */}
      <Dialog
        open={showKeyboardMapDialog}
        onOpenChange={setShowKeyboardMapDialog}
      >
        <DialogContent className="bg-popover border-border max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="w-5 h-5 text-brand-500" />
              Keyboard Shortcut Map
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Visual overview of all keyboard shortcuts. Keys in color are bound
              to shortcuts. Click on any shortcut below to edit it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 py-4 pl-3 pr-6 pb-6">
            {/* Visual Keyboard Map */}
            <KeyboardMap />

            {/* Shortcut Reference - Editable */}
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-4">
                All Shortcuts Reference (Click to Edit)
              </h3>
              <ShortcutReferencePanel editable />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-popover border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Delete Project
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to move this project to Trash?
            </DialogDescription>
          </DialogHeader>

          {currentProject && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-sidebar-accent/10 border border-sidebar-border">
              <div className="w-10 h-10 rounded-lg bg-sidebar-accent/20 border border-sidebar-border flex items-center justify-center shrink-0">
                <Folder className="w-5 h-5 text-brand-500" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">
                  {currentProject.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentProject.path}
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            The folder will remain on disk until you permanently delete it from
            Trash.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (currentProject) {
                  moveProjectToTrash(currentProject.id);
                  setShowDeleteDialog(false);
                }
              }}
              data-testid="confirm-delete-project"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
