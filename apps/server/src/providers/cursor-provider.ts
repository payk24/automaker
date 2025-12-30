/**
 * Cursor Provider - Executes queries using cursor-agent CLI
 *
 * Extends CliProvider with Cursor-specific:
 * - Event normalization for Cursor's JSONL format
 * - Text block deduplication (Cursor sends duplicates)
 * - Session ID tracking
 * - Versions directory detection
 *
 * Spawns the cursor-agent CLI with --output-format stream-json for streaming responses.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CliProvider,
  type CliSpawnConfig,
  type CliDetectionResult,
  type CliErrorInfo,
} from './cli-provider.js';
import type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  ContentBlock,
} from './types.js';
import { stripProviderPrefix } from '@automaker/types';
import {
  type CursorStreamEvent,
  type CursorSystemEvent,
  type CursorAssistantEvent,
  type CursorToolCallEvent,
  type CursorResultEvent,
  type CursorAuthStatus,
  CURSOR_MODEL_MAP,
} from '@automaker/types';
import { createLogger, isAbortError } from '@automaker/utils';
import { spawnJSONLProcess, execInWsl } from '@automaker/platform';

// Create logger for this module
const logger = createLogger('CursorProvider');

/**
 * Cursor-specific error codes for detailed error handling
 */
export enum CursorErrorCode {
  NOT_INSTALLED = 'CURSOR_NOT_INSTALLED',
  NOT_AUTHENTICATED = 'CURSOR_NOT_AUTHENTICATED',
  RATE_LIMITED = 'CURSOR_RATE_LIMITED',
  MODEL_UNAVAILABLE = 'CURSOR_MODEL_UNAVAILABLE',
  NETWORK_ERROR = 'CURSOR_NETWORK_ERROR',
  PROCESS_CRASHED = 'CURSOR_PROCESS_CRASHED',
  TIMEOUT = 'CURSOR_TIMEOUT',
  UNKNOWN = 'CURSOR_UNKNOWN_ERROR',
}

export interface CursorError extends Error {
  code: CursorErrorCode;
  recoverable: boolean;
  suggestion?: string;
}

/**
 * CursorProvider - Integrates cursor-agent CLI as an AI provider
 *
 * Extends CliProvider with Cursor-specific behavior:
 * - WSL required on Windows (cursor-agent has no native Windows build)
 * - Versions directory detection for cursor-agent installations
 * - Session ID tracking for conversation continuity
 * - Text block deduplication (Cursor sends duplicate chunks)
 */
export class CursorProvider extends CliProvider {
  /**
   * Version data directory where cursor-agent stores versions
   * The install script creates versioned folders like:
   *   ~/.local/share/cursor-agent/versions/2025.12.17-996666f/cursor-agent
   */
  private static VERSIONS_DIR = path.join(os.homedir(), '.local/share/cursor-agent/versions');

  constructor(config: ProviderConfig = {}) {
    super(config);
    // Trigger CLI detection on construction (eager for Cursor)
    this.ensureCliDetected();
  }

  // ==========================================================================
  // CliProvider Abstract Method Implementations
  // ==========================================================================

  getName(): string {
    return 'cursor';
  }

  getCliName(): string {
    return 'cursor-agent';
  }

  getSpawnConfig(): CliSpawnConfig {
    return {
      windowsStrategy: 'wsl', // cursor-agent requires WSL on Windows
      commonPaths: {
        linux: [
          path.join(os.homedir(), '.local/bin/cursor-agent'), // Primary symlink location
          '/usr/local/bin/cursor-agent',
        ],
        darwin: [path.join(os.homedir(), '.local/bin/cursor-agent'), '/usr/local/bin/cursor-agent'],
        // Windows paths are not used - we check for WSL installation instead
        win32: [],
      },
    };
  }

  /**
   * Extract prompt text from ExecuteOptions
   * Used to pass prompt via stdin instead of CLI args to avoid shell escaping issues
   */
  private extractPromptText(options: ExecuteOptions): string {
    if (typeof options.prompt === 'string') {
      return options.prompt;
    } else if (Array.isArray(options.prompt)) {
      return options.prompt
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n');
    } else {
      throw new Error('Invalid prompt format');
    }
  }

  buildCliArgs(options: ExecuteOptions): string[] {
    // Extract model (strip 'cursor-' prefix if present)
    const model = stripProviderPrefix(options.model || 'auto');

    // Build CLI arguments for cursor-agent
    // NOTE: Prompt is NOT included here - it's passed via stdin to avoid
    // shell escaping issues when content contains $(), backticks, etc.
    const cliArgs: string[] = [
      '-p', // Print mode (non-interactive)
      '--output-format',
      'stream-json',
      '--stream-partial-output', // Real-time streaming
    ];

    // Only add --force if NOT in read-only mode
    // Without --force, Cursor CLI suggests changes but doesn't apply them
    // With --force, Cursor CLI can actually edit files
    if (!options.readOnly) {
      cliArgs.push('--force');
    }

    // Add model if not auto
    if (model !== 'auto') {
      cliArgs.push('--model', model);
    }

    // Use '-' to indicate reading prompt from stdin
    cliArgs.push('-');

    return cliArgs;
  }

  /**
   * Convert Cursor event to AutoMaker ProviderMessage format
   * Made public as required by CliProvider abstract method
   */
  normalizeEvent(event: unknown): ProviderMessage | null {
    const cursorEvent = event as CursorStreamEvent;

    switch (cursorEvent.type) {
      case 'system':
        // System init - we capture session_id but don't yield a message
        return null;

      case 'user':
        // User message - already handled by caller
        return null;

      case 'assistant': {
        const assistantEvent = cursorEvent as CursorAssistantEvent;
        return {
          type: 'assistant',
          session_id: assistantEvent.session_id,
          message: {
            role: 'assistant',
            content: assistantEvent.message.content.map((c) => ({
              type: 'text' as const,
              text: c.text,
            })),
          },
        };
      }

      case 'tool_call': {
        const toolEvent = cursorEvent as CursorToolCallEvent;
        const toolCall = toolEvent.tool_call;

        // Determine tool name and input
        let toolName: string;
        let toolInput: unknown;

        if (toolCall.readToolCall) {
          // Skip if args not yet populated (partial streaming event)
          if (!toolCall.readToolCall.args) return null;
          toolName = 'Read';
          toolInput = { file_path: toolCall.readToolCall.args.path };
        } else if (toolCall.writeToolCall) {
          // Skip if args not yet populated (partial streaming event)
          if (!toolCall.writeToolCall.args) return null;
          toolName = 'Write';
          toolInput = {
            file_path: toolCall.writeToolCall.args.path,
            content: toolCall.writeToolCall.args.fileText,
          };
        } else if (toolCall.function) {
          toolName = toolCall.function.name;
          try {
            toolInput = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolInput = { raw: toolCall.function.arguments };
          }
        } else {
          return null;
        }

        // For started events, emit tool_use
        if (toolEvent.subtype === 'started') {
          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolName,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
              ],
            },
          };
        }

        // For completed events, emit both tool_use and tool_result
        if (toolEvent.subtype === 'completed') {
          let resultContent = '';

          if (toolCall.readToolCall?.result?.success) {
            resultContent = toolCall.readToolCall.result.success.content;
          } else if (toolCall.writeToolCall?.result?.success) {
            resultContent = `Wrote ${toolCall.writeToolCall.result.success.linesCreated} lines to ${toolCall.writeToolCall.result.success.path}`;
          }

          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolName,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
                {
                  type: 'tool_result',
                  tool_use_id: toolEvent.call_id,
                  content: resultContent,
                },
              ],
            },
          };
        }

        return null;
      }

      case 'result': {
        const resultEvent = cursorEvent as CursorResultEvent;

        if (resultEvent.is_error) {
          return {
            type: 'error',
            session_id: resultEvent.session_id,
            error: resultEvent.error || resultEvent.result || 'Unknown error',
          };
        }

        return {
          type: 'result',
          subtype: 'success',
          session_id: resultEvent.session_id,
          result: resultEvent.result,
        };
      }

      default:
        return null;
    }
  }

  // ==========================================================================
  // CliProvider Overrides
  // ==========================================================================

  /**
   * Override CLI detection to add Cursor-specific versions directory check
   */
  protected detectCli(): CliDetectionResult {
    // First try standard detection (PATH, common paths, WSL)
    const result = super.detectCli();
    if (result.cliPath) {
      return result;
    }

    // Cursor-specific: Check versions directory for any installed version
    // This handles cases where cursor-agent is installed but not in PATH
    if (process.platform !== 'win32' && fs.existsSync(CursorProvider.VERSIONS_DIR)) {
      try {
        const versions = fs
          .readdirSync(CursorProvider.VERSIONS_DIR)
          .filter((v) => !v.startsWith('.'))
          .sort()
          .reverse(); // Most recent first

        for (const version of versions) {
          const versionPath = path.join(CursorProvider.VERSIONS_DIR, version, 'cursor-agent');
          if (fs.existsSync(versionPath)) {
            logger.debug(`Found cursor-agent version ${version} at: ${versionPath}`);
            return {
              cliPath: versionPath,
              useWsl: false,
              strategy: 'native',
            };
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    return result;
  }

  /**
   * Override error mapping for Cursor-specific error codes
   */
  protected mapError(stderr: string, exitCode: number | null): CliErrorInfo {
    const lower = stderr.toLowerCase();

    if (
      lower.includes('not authenticated') ||
      lower.includes('please log in') ||
      lower.includes('unauthorized')
    ) {
      return {
        code: CursorErrorCode.NOT_AUTHENTICATED,
        message: 'Cursor CLI is not authenticated',
        recoverable: true,
        suggestion: 'Run "cursor-agent login" to authenticate with your browser',
      };
    }

    if (
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('429')
    ) {
      return {
        code: CursorErrorCode.RATE_LIMITED,
        message: 'Cursor API rate limit exceeded',
        recoverable: true,
        suggestion: 'Wait a few minutes and try again, or upgrade to Cursor Pro',
      };
    }

    if (
      lower.includes('model not available') ||
      lower.includes('invalid model') ||
      lower.includes('unknown model')
    ) {
      return {
        code: CursorErrorCode.MODEL_UNAVAILABLE,
        message: 'Requested model is not available',
        recoverable: true,
        suggestion: 'Try using "auto" mode or select a different model',
      };
    }

    if (
      lower.includes('network') ||
      lower.includes('connection') ||
      lower.includes('econnrefused') ||
      lower.includes('timeout')
    ) {
      return {
        code: CursorErrorCode.NETWORK_ERROR,
        message: 'Network connection error',
        recoverable: true,
        suggestion: 'Check your internet connection and try again',
      };
    }

    if (exitCode === 137 || lower.includes('killed') || lower.includes('sigterm')) {
      return {
        code: CursorErrorCode.PROCESS_CRASHED,
        message: 'Cursor agent process was terminated',
        recoverable: true,
        suggestion: 'The process may have run out of memory. Try a simpler task.',
      };
    }

    return {
      code: CursorErrorCode.UNKNOWN,
      message: stderr || `Cursor agent exited with code ${exitCode}`,
      recoverable: false,
    };
  }

  /**
   * Override install instructions for Cursor-specific guidance
   */
  protected getInstallInstructions(): string {
    if (process.platform === 'win32') {
      return 'cursor-agent requires WSL on Windows. Install WSL, then run in WSL: curl https://cursor.com/install -fsS | bash';
    }
    return 'Install with: curl https://cursor.com/install -fsS | bash';
  }

  /**
   * Execute a prompt using Cursor CLI with streaming
   *
   * Overrides base class to add:
   * - Session ID tracking from system init events
   * - Text block deduplication (Cursor sends duplicate chunks)
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    this.ensureCliDetected();

    if (!this.cliPath) {
      throw this.createError(
        CursorErrorCode.NOT_INSTALLED,
        'Cursor CLI is not installed',
        true,
        this.getInstallInstructions()
      );
    }

    // Extract prompt text to pass via stdin (avoids shell escaping issues)
    const promptText = this.extractPromptText(options);

    const cliArgs = this.buildCliArgs(options);
    const subprocessOptions = this.buildSubprocessOptions(options, cliArgs);

    // Pass prompt via stdin to avoid shell interpretation of special characters
    // like $(), backticks, etc. that may appear in file content
    subprocessOptions.stdinData = promptText;

    let sessionId: string | undefined;

    // Dedup state for Cursor-specific text block handling
    let lastTextBlock = '';
    let accumulatedText = '';

    logger.debug(`CursorProvider.executeQuery called with model: "${options.model}"`);

    try {
      for await (const rawEvent of spawnJSONLProcess(subprocessOptions)) {
        const event = rawEvent as CursorStreamEvent;

        // Capture session ID from system init
        if (event.type === 'system' && (event as CursorSystemEvent).subtype === 'init') {
          sessionId = event.session_id;
          logger.debug(`Session started: ${sessionId}`);
        }

        // Normalize and yield the event
        const normalized = this.normalizeEvent(event);
        if (normalized) {
          // Ensure session_id is always set
          if (!normalized.session_id && sessionId) {
            normalized.session_id = sessionId;
          }

          // Apply Cursor-specific dedup for assistant text messages
          if (normalized.type === 'assistant' && normalized.message?.content) {
            const dedupedContent = this.deduplicateTextBlocks(
              normalized.message.content,
              lastTextBlock,
              accumulatedText
            );

            if (dedupedContent.content.length === 0) {
              // All blocks were duplicates, skip this message
              continue;
            }

            // Update state
            lastTextBlock = dedupedContent.lastBlock;
            accumulatedText = dedupedContent.accumulated;

            // Update the message with deduped content
            normalized.message.content = dedupedContent.content;
          }

          yield normalized;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        logger.debug('Query aborted');
        return;
      }

      // Map CLI errors to CursorError
      if (error instanceof Error && 'stderr' in error) {
        const errorInfo = this.mapError(
          (error as { stderr?: string }).stderr || error.message,
          (error as { exitCode?: number | null }).exitCode ?? null
        );
        throw this.createError(
          errorInfo.code as CursorErrorCode,
          errorInfo.message,
          errorInfo.recoverable,
          errorInfo.suggestion
        );
      }
      throw error;
    }
  }

  // ==========================================================================
  // Cursor-Specific Methods
  // ==========================================================================

  /**
   * Create a CursorError with details
   */
  private createError(
    code: CursorErrorCode,
    message: string,
    recoverable: boolean = false,
    suggestion?: string
  ): CursorError {
    const error = new Error(message) as CursorError;
    error.code = code;
    error.recoverable = recoverable;
    error.suggestion = suggestion;
    error.name = 'CursorError';
    return error;
  }

  /**
   * Deduplicate text blocks in Cursor assistant messages
   *
   * Cursor often sends:
   * 1. Duplicate consecutive text blocks (same text twice in a row)
   * 2. A final accumulated block containing ALL previous text
   *
   * This method filters out these duplicates to prevent UI stuttering.
   */
  private deduplicateTextBlocks(
    content: ContentBlock[],
    lastTextBlock: string,
    accumulatedText: string
  ): { content: ContentBlock[]; lastBlock: string; accumulated: string } {
    const filtered: ContentBlock[] = [];
    let newLastBlock = lastTextBlock;
    let newAccumulated = accumulatedText;

    for (const block of content) {
      if (block.type !== 'text' || !block.text) {
        filtered.push(block);
        continue;
      }

      const text = block.text;

      // Skip empty text
      if (!text.trim()) continue;

      // Skip duplicate consecutive text blocks
      if (text === newLastBlock) {
        continue;
      }

      // Skip final accumulated text block
      // Cursor sends one large block containing ALL previous text at the end
      if (newAccumulated.length > 100 && text.length > newAccumulated.length * 0.8) {
        const normalizedAccum = newAccumulated.replace(/\s+/g, ' ').trim();
        const normalizedNew = text.replace(/\s+/g, ' ').trim();
        if (normalizedNew.includes(normalizedAccum.slice(0, 100))) {
          // This is the final accumulated block, skip it
          continue;
        }
      }

      // This is a valid new text block
      newLastBlock = text;
      newAccumulated += text;
      filtered.push(block);
    }

    return {
      content: filtered,
      lastBlock: newLastBlock,
      accumulated: newAccumulated,
    };
  }

  /**
   * Get Cursor CLI version
   */
  async getVersion(): Promise<string | null> {
    this.ensureCliDetected();
    if (!this.cliPath) return null;

    try {
      if (this.useWsl && this.wslCliPath) {
        const result = execInWsl(`${this.wslCliPath} --version`, {
          timeout: 5000,
          distribution: this.wslDistribution,
        });
        return result;
      }
      const result = execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(): Promise<CursorAuthStatus> {
    this.ensureCliDetected();
    if (!this.cliPath) {
      return { authenticated: false, method: 'none' };
    }

    // Check for API key in environment
    if (process.env.CURSOR_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

    // For WSL mode, check credentials inside WSL
    if (this.useWsl && this.wslCliPath) {
      const wslOpts = { timeout: 5000, distribution: this.wslDistribution };

      // Check for credentials file inside WSL
      const wslCredPaths = [
        '$HOME/.cursor/credentials.json',
        '$HOME/.config/cursor/credentials.json',
      ];

      for (const credPath of wslCredPaths) {
        const content = execInWsl(`sh -c "cat ${credPath} 2>/dev/null || echo ''"`, wslOpts);
        if (content && content.trim()) {
          try {
            const creds = JSON.parse(content);
            if (creds.accessToken || creds.token) {
              return { authenticated: true, method: 'login', hasCredentialsFile: true };
            }
          } catch {
            // Invalid credentials file
          }
        }
      }

      // Try running --version to check if CLI works
      const versionResult = execInWsl(`${this.wslCliPath} --version`, {
        timeout: 10000,
        distribution: this.wslDistribution,
      });
      if (versionResult) {
        return { authenticated: true, method: 'login' };
      }

      return { authenticated: false, method: 'none' };
    }

    // Native mode (Linux/macOS) - check local credentials
    const credentialPaths = [
      path.join(os.homedir(), '.cursor', 'credentials.json'),
      path.join(os.homedir(), '.config', 'cursor', 'credentials.json'),
    ];

    for (const credPath of credentialPaths) {
      if (fs.existsSync(credPath)) {
        try {
          const content = fs.readFileSync(credPath, 'utf8');
          const creds = JSON.parse(content);
          if (creds.accessToken || creds.token) {
            return { authenticated: true, method: 'login', hasCredentialsFile: true };
          }
        } catch {
          // Invalid credentials file
        }
      }
    }

    // Try running a simple command to check auth
    try {
      execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env },
      });
      return { authenticated: true, method: 'login' };
    } catch (error: unknown) {
      const execError = error as { stderr?: string };
      if (execError.stderr?.includes('not authenticated') || execError.stderr?.includes('log in')) {
        return { authenticated: false, method: 'none' };
      }
    }

    return { authenticated: false, method: 'none' };
  }

  /**
   * Detect installation status (required by BaseProvider)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    const installed = await this.isInstalled();
    const version = installed ? await this.getVersion() : undefined;
    const auth = await this.checkAuth();

    // Determine the display path - for WSL, show the WSL path with distribution
    const displayPath =
      this.useWsl && this.wslCliPath
        ? `(WSL${this.wslDistribution ? `:${this.wslDistribution}` : ''}) ${this.wslCliPath}`
        : this.cliPath || undefined;

    return {
      installed,
      version: version || undefined,
      path: displayPath,
      method: this.useWsl ? 'wsl' : 'cli',
      hasApiKey: !!process.env.CURSOR_API_KEY,
      authenticated: auth.authenticated,
    };
  }

  /**
   * Get available Cursor models
   */
  getAvailableModels(): ModelDefinition[] {
    return Object.entries(CURSOR_MODEL_MAP).map(([id, config]) => ({
      id: `cursor-${id}`,
      name: config.label,
      modelString: id,
      provider: 'cursor',
      description: config.description,
      tier: config.tier === 'pro' ? ('premium' as const) : ('basic' as const),
      supportsTools: true,
      supportsVision: false,
    }));
  }

  /**
   * Check if a feature is supported
   */
  supportsFeature(feature: string): boolean {
    const supported = ['tools', 'text', 'streaming'];
    return supported.includes(feature);
  }
}
