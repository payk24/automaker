/**
 * File system routes
 * Provides REST API equivalents for Electron IPC file operations
 */

import { Router, type Request, type Response } from "express";
import fs from "fs/promises";
import path from "path";
import { validatePath, addAllowedPath, isPathAllowed } from "../lib/security.js";
import type { EventEmitter } from "../lib/events.js";

export function createFsRoutes(_events: EventEmitter): Router {
  const router = Router();

  // Read file
  router.post("/read", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      const resolvedPath = validatePath(filePath);
      const content = await fs.readFile(resolvedPath, "utf-8");

      res.json({ success: true, content });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Write file
  router.post("/write", async (req: Request, res: Response) => {
    try {
      const { filePath, content } = req.body as {
        filePath: string;
        content: string;
      };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      const resolvedPath = validatePath(filePath);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, content, "utf-8");

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Create directory
  router.post("/mkdir", async (req: Request, res: Response) => {
    try {
      const { dirPath } = req.body as { dirPath: string };

      if (!dirPath) {
        res.status(400).json({ success: false, error: "dirPath is required" });
        return;
      }

      const resolvedPath = validatePath(dirPath);
      await fs.mkdir(resolvedPath, { recursive: true });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Read directory
  router.post("/readdir", async (req: Request, res: Response) => {
    try {
      const { dirPath } = req.body as { dirPath: string };

      if (!dirPath) {
        res.status(400).json({ success: false, error: "dirPath is required" });
        return;
      }

      const resolvedPath = validatePath(dirPath);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      const result = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));

      res.json({ success: true, entries: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Check if file/directory exists
  router.post("/exists", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      // For exists, we check but don't require the path to be pre-allowed
      // This allows the UI to validate user-entered paths
      const resolvedPath = path.resolve(filePath);

      try {
        await fs.access(resolvedPath);
        res.json({ success: true, exists: true });
      } catch {
        res.json({ success: true, exists: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Get file stats
  router.post("/stat", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      const resolvedPath = validatePath(filePath);
      const stats = await fs.stat(resolvedPath);

      res.json({
        success: true,
        stats: {
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          mtime: stats.mtime,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Delete file
  router.post("/delete", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      const resolvedPath = validatePath(filePath);
      await fs.rm(resolvedPath, { recursive: true });

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Validate and add path to allowed list
  // This is the web equivalent of dialog:openDirectory
  router.post("/validate-path", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: "filePath is required" });
        return;
      }

      const resolvedPath = path.resolve(filePath);

      // Check if path exists
      try {
        const stats = await fs.stat(resolvedPath);

        if (!stats.isDirectory()) {
          res.status(400).json({ success: false, error: "Path is not a directory" });
          return;
        }

        // Add to allowed paths
        addAllowedPath(resolvedPath);

        res.json({
          success: true,
          path: resolvedPath,
          isAllowed: isPathAllowed(resolvedPath),
        });
      } catch {
        res.status(400).json({ success: false, error: "Path does not exist" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Resolve directory path from directory name and file structure
  // Used when browser file picker only provides directory name (not full path)
  router.post("/resolve-directory", async (req: Request, res: Response) => {
    try {
      const { directoryName, sampleFiles, fileCount } = req.body as {
        directoryName: string;
        sampleFiles?: string[];
        fileCount?: number;
      };

      if (!directoryName) {
        res.status(400).json({ success: false, error: "directoryName is required" });
        return;
      }

      // If directoryName looks like an absolute path, try validating it directly
      if (path.isAbsolute(directoryName) || directoryName.includes(path.sep)) {
        try {
          const resolvedPath = path.resolve(directoryName);
          const stats = await fs.stat(resolvedPath);
          if (stats.isDirectory()) {
            addAllowedPath(resolvedPath);
            return res.json({
              success: true,
              path: resolvedPath,
            });
          }
        } catch {
          // Not a valid absolute path, continue to search
        }
      }

      // Search for directory in common locations
      const searchPaths: string[] = [
        process.cwd(), // Current working directory
        process.env.HOME || process.env.USERPROFILE || "", // User home
        path.join(process.env.HOME || process.env.USERPROFILE || "", "Documents"),
        path.join(process.env.HOME || process.env.USERPROFILE || "", "Desktop"),
        // Common project locations
        path.join(process.env.HOME || process.env.USERPROFILE || "", "Projects"),
      ].filter(Boolean);

      // Also check parent of current working directory
      try {
        const parentDir = path.dirname(process.cwd());
        if (!searchPaths.includes(parentDir)) {
          searchPaths.push(parentDir);
        }
      } catch {
        // Ignore
      }

      // Search for directory matching the name and file structure
      for (const searchPath of searchPaths) {
        try {
          const candidatePath = path.join(searchPath, directoryName);
          const stats = await fs.stat(candidatePath);
          
          if (stats.isDirectory()) {
            // Verify it matches by checking for sample files
            if (sampleFiles && sampleFiles.length > 0) {
              let matches = 0;
              for (const sampleFile of sampleFiles.slice(0, 5)) {
                // Remove directory name prefix from sample file path
                const relativeFile = sampleFile.startsWith(directoryName + "/")
                  ? sampleFile.substring(directoryName.length + 1)
                  : sampleFile.split("/").slice(1).join("/") || sampleFile.split("/").pop() || sampleFile;
                
                try {
                  const filePath = path.join(candidatePath, relativeFile);
                  await fs.access(filePath);
                  matches++;
                } catch {
                  // File doesn't exist, continue checking
                }
              }
              
              // If at least one file matches, consider it a match
              if (matches === 0 && sampleFiles.length > 0) {
                continue; // Try next candidate
              }
            }

            // Found matching directory
            addAllowedPath(candidatePath);
            return res.json({
              success: true,
              path: candidatePath,
            });
          }
        } catch {
          // Directory doesn't exist at this location, continue searching
          continue;
        }
      }

      // Directory not found
      res.status(404).json({
        success: false,
        error: `Directory "${directoryName}" not found in common locations. Please ensure the directory exists.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Save image to .automaker/images directory
  router.post("/save-image", async (req: Request, res: Response) => {
    try {
      const { data, filename, mimeType, projectPath } = req.body as {
        data: string;
        filename: string;
        mimeType: string;
        projectPath: string;
      };

      if (!data || !filename || !projectPath) {
        res.status(400).json({
          success: false,
          error: "data, filename, and projectPath are required",
        });
        return;
      }

      // Create .automaker/images directory if it doesn't exist
      const imagesDir = path.join(projectPath, ".automaker", "images");
      await fs.mkdir(imagesDir, { recursive: true });

      // Decode base64 data (remove data URL prefix if present)
      const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // Generate unique filename with timestamp
      const timestamp = Date.now();
      const ext = path.extname(filename) || ".png";
      const baseName = path.basename(filename, ext);
      const uniqueFilename = `${baseName}-${timestamp}${ext}`;
      const filePath = path.join(imagesDir, uniqueFilename);

      // Write file
      await fs.writeFile(filePath, buffer);

      // Add project path to allowed paths if not already
      addAllowedPath(projectPath);

      res.json({ success: true, path: filePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Serve image files
  router.get("/image", async (req: Request, res: Response) => {
    try {
      const { path: imagePath, projectPath } = req.query as {
        path?: string;
        projectPath?: string;
      };

      if (!imagePath) {
        res.status(400).json({ success: false, error: "path is required" });
        return;
      }

      // Resolve full path
      const fullPath = path.isAbsolute(imagePath)
        ? imagePath
        : projectPath
          ? path.join(projectPath, imagePath)
          : imagePath;

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        res.status(404).json({ success: false, error: "Image not found" });
        return;
      }

      // Read the file
      const buffer = await fs.readFile(fullPath);

      // Determine MIME type from extension
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
      };

      res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
