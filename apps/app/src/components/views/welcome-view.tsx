"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore, type ThemeMode } from "@/store/app-store";
import { getElectronAPI, type Project } from "@/lib/electron";
import { initializeProject } from "@/lib/project-init";
import {
  FolderOpen,
  Plus,
  Folder,
  Clock,
  Sparkles,
  MessageSquare,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { WorkspacePickerModal } from "@/components/workspace-picker-modal";
import { NewProjectModal } from "@/components/new-project-modal";
import { getHttpApiClient } from "@/lib/http-api-client";
import type { StarterTemplate } from "@/lib/templates";

export function WelcomeView() {
  const {
    projects,
    trashedProjects,
    currentProject,
    upsertAndSetCurrentProject,
    setCurrentView,
    theme: globalTheme,
  } = useAppStore();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [initStatus, setInitStatus] = useState<{
    isNewProject: boolean;
    createdFiles: string[];
    projectName: string;
    projectPath: string;
  } | null>(null);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  /**
   * Kick off project analysis agent to analyze the codebase
   */
  const analyzeProject = useCallback(async (projectPath: string) => {
    const api = getElectronAPI();

    if (!api.autoMode?.analyzeProject) {
      console.log("[Welcome] Auto mode API not available, skipping analysis");
      return;
    }

    setIsAnalyzing(true);
    try {
      console.log("[Welcome] Starting project analysis for:", projectPath);
      const result = await api.autoMode.analyzeProject(projectPath);

      if (result.success) {
        toast.success("Project analyzed", {
          description: "AI agent has analyzed your project structure",
        });
      } else {
        console.error("[Welcome] Project analysis failed:", result.error);
      }
    } catch (error) {
      console.error("[Welcome] Failed to analyze project:", error);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Initialize project and optionally kick off project analysis agent
   */
  const initializeAndOpenProject = useCallback(
    async (path: string, name: string) => {
      setIsOpening(true);
      try {
        // Initialize the .automaker directory structure
        const initResult = await initializeProject(path);

        if (!initResult.success) {
          toast.error("Failed to initialize project", {
            description: initResult.error || "Unknown error occurred",
          });
          return;
        }

        // Upsert project and set as current (handles both create and update cases)
        // Theme preservation is handled by the store action
        const trashedProject = trashedProjects.find((p) => p.path === path);
        const effectiveTheme =
          (trashedProject?.theme as ThemeMode | undefined) ||
          (currentProject?.theme as ThemeMode | undefined) ||
          globalTheme;
        const project = upsertAndSetCurrentProject(path, name, effectiveTheme);

        // Show initialization dialog if files were created
        if (initResult.createdFiles && initResult.createdFiles.length > 0) {
          setInitStatus({
            isNewProject: initResult.isNewProject,
            createdFiles: initResult.createdFiles,
            projectName: name,
            projectPath: path,
          });
          setShowInitDialog(true);

          // Kick off agent to analyze the project and update app_spec.txt
          console.log(
            "[Welcome] Project initialized, created files:",
            initResult.createdFiles
          );
          console.log("[Welcome] Kicking off project analysis agent...");

          // Start analysis in background (don't await, let it run async)
          analyzeProject(path);
        } else {
          toast.success("Project opened", {
            description: `Opened ${name}`,
          });
        }
      } catch (error) {
        console.error("[Welcome] Failed to open project:", error);
        toast.error("Failed to open project", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setIsOpening(false);
      }
    },
    [
      trashedProjects,
      currentProject,
      globalTheme,
      upsertAndSetCurrentProject,
      analyzeProject,
    ]
  );

  const handleOpenProject = useCallback(async () => {
    try {
      // Check if workspace is configured
      const httpClient = getHttpApiClient();
      const configResult = await httpClient.workspace.getConfig();

      if (configResult.success && configResult.configured) {
        // Show workspace picker modal
        setShowWorkspacePicker(true);
      } else {
        // Fall back to current behavior (native dialog or manual input)
        const api = getElectronAPI();
        const result = await api.openDirectory();

        if (!result.canceled && result.filePaths[0]) {
          const path = result.filePaths[0];
          // Extract folder name from path (works on both Windows and Mac/Linux)
          const name =
            path.split(/[/\\]/).filter(Boolean).pop() || "Untitled Project";
          await initializeAndOpenProject(path, name);
        }
      }
    } catch (error) {
      console.error("[Welcome] Failed to check workspace config:", error);
      // Fall back to current behavior on error
      const api = getElectronAPI();
      const result = await api.openDirectory();

      if (!result.canceled && result.filePaths[0]) {
        const path = result.filePaths[0];
        const name =
          path.split(/[/\\]/).filter(Boolean).pop() || "Untitled Project";
        await initializeAndOpenProject(path, name);
      }
    }
  }, [initializeAndOpenProject]);

  /**
   * Handle selecting a project from workspace picker
   */
  const handleWorkspaceSelect = useCallback(
    async (path: string, name: string) => {
      setShowWorkspacePicker(false);
      await initializeAndOpenProject(path, name);
    },
    [initializeAndOpenProject]
  );

  /**
   * Handle clicking on a recent project
   */
  const handleRecentProjectClick = useCallback(
    async (project: { id: string; name: string; path: string }) => {
      await initializeAndOpenProject(project.path, project.name);
    },
    [initializeAndOpenProject]
  );

  const handleNewProject = () => {
    setShowNewProjectModal(true);
  };

  const handleInteractiveMode = () => {
    setCurrentView("interview");
  };

  /**
   * Create a blank project with just .automaker directory structure
   */
  const handleCreateBlankProject = async (
    projectName: string,
    parentDir: string
  ) => {
    setIsCreating(true);
    try {
      const api = getElectronAPI();
      const projectPath = `${parentDir}/${projectName}`;

      // Create project directory
      await api.mkdir(projectPath);

      // Initialize .automaker directory with all necessary files
      const initResult = await initializeProject(projectPath);

      if (!initResult.success) {
        toast.error("Failed to initialize project", {
          description: initResult.error || "Unknown error occurred",
        });
        return;
      }

      // Update the app_spec.txt with the project name
      await api.writeFile(
        `${projectPath}/.automaker/app_spec.txt`,
        `<project_specification>
  <project_name>${projectName}</project_name>

  <overview>
    Describe your project here. This file will be analyzed by an AI agent
    to understand your project structure and tech stack.
  </overview>

  <technology_stack>
    <!-- The AI agent will fill this in after analyzing your project -->
  </technology_stack>

  <core_capabilities>
    <!-- List core features and capabilities -->
  </core_capabilities>

  <implemented_features>
    <!-- The AI agent will populate this based on code analysis -->
  </implemented_features>
</project_specification>`
      );

      const project = {
        id: `project-${Date.now()}`,
        name: projectName,
        path: projectPath,
        lastOpened: new Date().toISOString(),
      };

      addProject(project);
      setCurrentProject(project);
      setShowNewProjectModal(false);

      toast.success("Project created", {
        description: `Created ${projectName} with .automaker directory`,
      });

      // Set init status to show the dialog
      setInitStatus({
        isNewProject: true,
        createdFiles: initResult.createdFiles || [],
        projectName: projectName,
        projectPath: projectPath,
      });
      setShowInitDialog(true);
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Failed to create project", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Create a project from a GitHub starter template
   */
  const handleCreateFromTemplate = async (
    template: StarterTemplate,
    projectName: string,
    parentDir: string
  ) => {
    setIsCreating(true);
    try {
      const httpClient = getHttpApiClient();
      const api = getElectronAPI();

      // Clone the template repository
      const cloneResult = await httpClient.templates.clone(
        template.repoUrl,
        projectName,
        parentDir
      );

      if (!cloneResult.success || !cloneResult.projectPath) {
        toast.error("Failed to clone template", {
          description: cloneResult.error || "Unknown error occurred",
        });
        return;
      }

      const projectPath = cloneResult.projectPath;

      // Initialize .automaker directory with all necessary files
      const initResult = await initializeProject(projectPath);

      if (!initResult.success) {
        toast.error("Failed to initialize project", {
          description: initResult.error || "Unknown error occurred",
        });
        return;
      }

      // Update the app_spec.txt with template-specific info
      await api.writeFile(
        `${projectPath}/.automaker/app_spec.txt`,
        `<project_specification>
  <project_name>${projectName}</project_name>

  <overview>
    This project was created from the "${template.name}" starter template.
    ${template.description}
  </overview>

  <technology_stack>
    ${template.techStack
      .map((tech) => `<technology>${tech}</technology>`)
      .join("\n    ")}
  </technology_stack>

  <core_capabilities>
    ${template.features
      .map((feature) => `<capability>${feature}</capability>`)
      .join("\n    ")}
  </core_capabilities>

  <implemented_features>
    <!-- The AI agent will populate this based on code analysis -->
  </implemented_features>
</project_specification>`
      );

      const project = {
        id: `project-${Date.now()}`,
        name: projectName,
        path: projectPath,
        lastOpened: new Date().toISOString(),
      };

      addProject(project);
      setCurrentProject(project);
      setShowNewProjectModal(false);

      toast.success("Project created from template", {
        description: `Created ${projectName} from ${template.name}`,
      });

      // Set init status to show the dialog
      setInitStatus({
        isNewProject: true,
        createdFiles: initResult.createdFiles || [],
        projectName: projectName,
        projectPath: projectPath,
      });
      setShowInitDialog(true);

      // Kick off project analysis
      analyzeProject(projectPath);
    } catch (error) {
      console.error("Failed to create project from template:", error);
      toast.error("Failed to create project", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Create a project from a custom GitHub URL
   */
  const handleCreateFromCustomUrl = async (
    repoUrl: string,
    projectName: string,
    parentDir: string
  ) => {
    setIsCreating(true);
    try {
      const httpClient = getHttpApiClient();
      const api = getElectronAPI();

      // Clone the repository
      const cloneResult = await httpClient.templates.clone(
        repoUrl,
        projectName,
        parentDir
      );

      if (!cloneResult.success || !cloneResult.projectPath) {
        toast.error("Failed to clone repository", {
          description: cloneResult.error || "Unknown error occurred",
        });
        return;
      }

      const projectPath = cloneResult.projectPath;

      // Initialize .automaker directory with all necessary files
      const initResult = await initializeProject(projectPath);

      if (!initResult.success) {
        toast.error("Failed to initialize project", {
          description: initResult.error || "Unknown error occurred",
        });
        return;
      }

      // Update the app_spec.txt with basic info
      await api.writeFile(
        `${projectPath}/.automaker/app_spec.txt`,
        `<project_specification>
  <project_name>${projectName}</project_name>

  <overview>
    This project was cloned from ${repoUrl}.
    The AI agent will analyze the project structure.
  </overview>

  <technology_stack>
    <!-- The AI agent will fill this in after analyzing your project -->
  </technology_stack>

  <core_capabilities>
    <!-- List core features and capabilities -->
  </core_capabilities>

  <implemented_features>
    <!-- The AI agent will populate this based on code analysis -->
  </implemented_features>
</project_specification>`
      );

      const project = {
        id: `project-${Date.now()}`,
        name: projectName,
        path: projectPath,
        lastOpened: new Date().toISOString(),
      };

      addProject(project);
      setCurrentProject(project);
      setShowNewProjectModal(false);

      toast.success("Project created from repository", {
        description: `Created ${projectName} from ${repoUrl}`,
      });

      // Set init status to show the dialog
      setInitStatus({
        isNewProject: true,
        createdFiles: initResult.createdFiles || [],
        projectName: projectName,
        projectPath: projectPath,
      });
      setShowInitDialog(true);

      // Kick off project analysis
      analyzeProject(projectPath);
    } catch (error) {
      console.error("Failed to create project from custom URL:", error);
      toast.error("Failed to create project", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const recentProjects = [...projects]
    .sort((a, b) => {
      const dateA = a.lastOpened ? new Date(a.lastOpened).getTime() : 0;
      const dateB = b.lastOpened ? new Date(b.lastOpened).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, 5);

  return (
    <div className="flex-1 flex flex-col content-bg" data-testid="welcome-view">
      {/* Header Section */}
      <div className="flex-shrink-0 border-b border-border bg-glass backdrop-blur-md">
        <div className="px-8 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center">
              <img src="/logo.png" alt="Automaker Logo" className="w-10 h-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Welcome to Automaker
              </h1>
              <p className="text-sm text-muted-foreground">
                Your autonomous AI development studio
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto">
          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div
              className="group relative overflow-hidden rounded-xl border border-border bg-card backdrop-blur-md hover:bg-card/70 hover:border-border-glass transition-all duration-200"
              data-testid="new-project-card"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-purple-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative p-6 h-full flex flex-col">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-12 h-12 rounded-lg bg-linear-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/20 flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                    <Plus className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground mb-1">
                      New Project
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Create a new project from scratch with AI-powered
                      development
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="w-full mt-4 bg-linear-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-600 text-primary-foreground border-0"
                      data-testid="create-new-project"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Project
                      <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={handleNewProject}
                      data-testid="quick-setup-option"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Quick Setup
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleInteractiveMode}
                      data-testid="interactive-mode-option"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Interactive Mode
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div
              className="group relative overflow-hidden rounded-xl border border-border bg-card backdrop-blur-md hover:bg-card/70 hover:border-border-glass transition-all duration-200 cursor-pointer"
              onClick={handleOpenProject}
              data-testid="open-project-card"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative p-6 h-full flex flex-col">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                    <FolderOpen className="w-6 h-6 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground mb-1">
                      Open Project
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Open an existing project folder to continue working
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="w-full mt-4 bg-secondary hover:bg-secondary/80 text-foreground border border-border hover:border-border-glass"
                  data-testid="open-existing-project"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Browse Folder
                </Button>
              </div>
            </div>
          </div>

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">
                  Recent Projects
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recentProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card backdrop-blur-md hover:bg-card/70 hover:border-brand-500/50 transition-all duration-200 cursor-pointer"
                    onClick={() => handleRecentProjectClick(project)}
                    data-testid={`recent-project-${project.id}`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-brand-500/0 to-purple-600/0 group-hover:from-brand-500/5 group-hover:to-purple-600/5 transition-all"></div>
                    <div className="relative p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center group-hover:border-brand-500/50 transition-colors">
                          <Folder className="w-5 h-5 text-muted-foreground group-hover:text-brand-500 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate group-hover:text-brand-500 transition-colors">
                            {project.name}
                          </p>
                          <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                            {project.path}
                          </p>
                          {project.lastOpened && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(
                                project.lastOpened
                              ).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State for No Projects */}
          {recentProjects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No projects yet
              </h3>
              <p className="text-sm text-zinc-400 max-w-md">
                Get started by creating a new project or opening an existing one
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New Project Modal */}
      <NewProjectModal
        open={showNewProjectModal}
        onOpenChange={setShowNewProjectModal}
        onCreateBlankProject={handleCreateBlankProject}
        onCreateFromTemplate={handleCreateFromTemplate}
        onCreateFromCustomUrl={handleCreateFromCustomUrl}
        isCreating={isCreating}
      />

      {/* Project Initialization Dialog */}
      <Dialog open={showInitDialog} onOpenChange={setShowInitDialog}>
        <DialogContent
          className="bg-card border-border"
          data-testid="project-init-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-brand-500" />
              {initStatus?.isNewProject
                ? "Project Initialized"
                : "Project Updated"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {initStatus?.isNewProject
                ? `Created .automaker directory structure for ${initStatus?.projectName}`
                : `Updated missing files in .automaker for ${initStatus?.projectName}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <p className="text-sm text-foreground font-medium">
                Created files:
              </p>
              <ul className="space-y-1.5">
                {initStatus?.createdFiles.map((file) => (
                  <li
                    key={file}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">
                      {file}
                    </code>
                  </li>
                ))}
              </ul>
            </div>

            {initStatus?.isNewProject && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border-glass">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />
                    <p className="text-sm text-brand-400">
                      AI agent is analyzing your project structure...
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <span className="text-brand-400">Tip:</span> Edit the{" "}
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      app_spec.txt
                    </code>{" "}
                    file to describe your project. The AI agent will use this to
                    understand your project structure.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setShowInitDialog(false)}
              className="bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-600 text-white border-0"
              data-testid="close-init-dialog"
            >
              Get Started
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workspace Picker Modal */}
      <WorkspacePickerModal
        open={showWorkspacePicker}
        onOpenChange={setShowWorkspacePicker}
        onSelect={handleWorkspaceSelect}
      />

      {/* Loading overlay when opening project */}
      {isOpening && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          data-testid="project-opening-overlay"
        >
          <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-card border border-border">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
            <p className="text-foreground font-medium">
              Initializing project...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
