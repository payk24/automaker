const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // IPC test
  ping: () => ipcRenderer.invoke("ping"),

  // Dialog APIs
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  openFile: (options) => ipcRenderer.invoke("dialog:openFile", options),

  // File system APIs
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  exists: (filePath) => ipcRenderer.invoke("fs:exists", filePath),
  stat: (filePath) => ipcRenderer.invoke("fs:stat", filePath),
  deleteFile: (filePath) => ipcRenderer.invoke("fs:deleteFile", filePath),
  trashItem: (filePath) => ipcRenderer.invoke("fs:trashItem", filePath),

  // App APIs
  getPath: (name) => ipcRenderer.invoke("app:getPath", name),
  saveImageToTemp: (data, filename, mimeType) =>
    ipcRenderer.invoke("app:saveImageToTemp", { data, filename, mimeType }),

  // Agent APIs
  agent: {
    // Start or resume a conversation
    start: (sessionId, workingDirectory) =>
      ipcRenderer.invoke("agent:start", { sessionId, workingDirectory }),

    // Send a message to the agent
    send: (sessionId, message, workingDirectory, imagePaths) =>
      ipcRenderer.invoke("agent:send", { sessionId, message, workingDirectory, imagePaths }),

    // Get conversation history
    getHistory: (sessionId) =>
      ipcRenderer.invoke("agent:getHistory", { sessionId }),

    // Stop current execution
    stop: (sessionId) =>
      ipcRenderer.invoke("agent:stop", { sessionId }),

    // Clear conversation
    clear: (sessionId) =>
      ipcRenderer.invoke("agent:clear", { sessionId }),

    // Subscribe to streaming events
    onStream: (callback) => {
      const subscription = (_, data) => callback(data);
      ipcRenderer.on("agent:stream", subscription);
      // Return unsubscribe function
      return () => ipcRenderer.removeListener("agent:stream", subscription);
    },
  },

  // Session Management APIs
  sessions: {
    // List all sessions
    list: (includeArchived) =>
      ipcRenderer.invoke("sessions:list", { includeArchived }),

    // Create a new session
    create: (name, projectPath, workingDirectory) =>
      ipcRenderer.invoke("sessions:create", { name, projectPath, workingDirectory }),

    // Update session metadata
    update: (sessionId, name, tags) =>
      ipcRenderer.invoke("sessions:update", { sessionId, name, tags }),

    // Archive a session
    archive: (sessionId) =>
      ipcRenderer.invoke("sessions:archive", { sessionId }),

    // Unarchive a session
    unarchive: (sessionId) =>
      ipcRenderer.invoke("sessions:unarchive", { sessionId }),

    // Delete a session permanently
    delete: (sessionId) =>
      ipcRenderer.invoke("sessions:delete", { sessionId }),
  },

  // Auto Mode API
  autoMode: {
    // Start auto mode
    start: (projectPath, maxConcurrency) =>
      ipcRenderer.invoke("auto-mode:start", { projectPath, maxConcurrency }),

    // Stop auto mode
    stop: () => ipcRenderer.invoke("auto-mode:stop"),

    // Get auto mode status
    status: () => ipcRenderer.invoke("auto-mode:status"),

    // Run a specific feature
    runFeature: (projectPath, featureId) =>
      ipcRenderer.invoke("auto-mode:run-feature", { projectPath, featureId }),

    // Verify a specific feature by running its tests
    verifyFeature: (projectPath, featureId) =>
      ipcRenderer.invoke("auto-mode:verify-feature", { projectPath, featureId }),

    // Resume a specific feature with previous context
    resumeFeature: (projectPath, featureId) =>
      ipcRenderer.invoke("auto-mode:resume-feature", { projectPath, featureId }),

    // Check if context file exists for a feature
    contextExists: (projectPath, featureId) =>
      ipcRenderer.invoke("auto-mode:context-exists", { projectPath, featureId }),

    // Analyze a new project - kicks off an agent to analyze codebase
    analyzeProject: (projectPath) =>
      ipcRenderer.invoke("auto-mode:analyze-project", { projectPath }),

    // Stop a specific feature
    stopFeature: (featureId) =>
      ipcRenderer.invoke("auto-mode:stop-feature", { featureId }),

    // Follow-up on a feature with additional prompt
    followUpFeature: (projectPath, featureId, prompt, imagePaths) =>
      ipcRenderer.invoke("auto-mode:follow-up-feature", { projectPath, featureId, prompt, imagePaths }),

    // Commit changes for a feature
    commitFeature: (projectPath, featureId) =>
      ipcRenderer.invoke("auto-mode:commit-feature", { projectPath, featureId }),

    // Listen for auto mode events
    onEvent: (callback) => {
      const subscription = (_, data) => callback(data);
      ipcRenderer.on("auto-mode:event", subscription);

      // Return unsubscribe function
      return () => {
        ipcRenderer.removeListener("auto-mode:event", subscription);
      };
    },
  },
});

// Also expose a flag to detect if we're in Electron
contextBridge.exposeInMainWorld("isElectron", true);
