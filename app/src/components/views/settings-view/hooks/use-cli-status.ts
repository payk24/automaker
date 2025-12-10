import { useState, useEffect, useCallback } from "react";
import { useSetupStore } from "@/store/setup-store";
import { getElectronAPI } from "@/lib/electron";

interface CliStatusResult {
  success: boolean;
  status?: string;
  method?: string;
  version?: string;
  path?: string;
  recommendation?: string;
  installCommands?: {
    macos?: string;
    windows?: string;
    linux?: string;
    npm?: string;
  };
  error?: string;
}

interface CodexCliStatusResult extends CliStatusResult {
  hasApiKey?: boolean;
}

/**
 * Custom hook for managing Claude and Codex CLI status
 * Handles checking CLI installation, authentication, and refresh functionality
 */
export function useCliStatus() {
  const { setClaudeAuthStatus, setCodexAuthStatus } = useSetupStore();

  const [claudeCliStatus, setClaudeCliStatus] =
    useState<CliStatusResult | null>(null);

  const [codexCliStatus, setCodexCliStatus] =
    useState<CodexCliStatusResult | null>(null);

  const [isCheckingClaudeCli, setIsCheckingClaudeCli] = useState(false);
  const [isCheckingCodexCli, setIsCheckingCodexCli] = useState(false);

  // Check CLI status on mount
  useEffect(() => {
    const checkCliStatus = async () => {
      const api = getElectronAPI();

      // Check Claude CLI
      if (api?.checkClaudeCli) {
        try {
          const status = await api.checkClaudeCli();
          setClaudeCliStatus(status);
        } catch (error) {
          console.error("Failed to check Claude CLI status:", error);
        }
      }

      // Check Codex CLI
      if (api?.checkCodexCli) {
        try {
          const status = await api.checkCodexCli();
          setCodexCliStatus(status);
        } catch (error) {
          console.error("Failed to check Codex CLI status:", error);
        }
      }

      // Check Claude auth status (re-fetch on mount to ensure persistence)
      if (api?.setup?.getClaudeStatus) {
        try {
          const result = await api.setup.getClaudeStatus();
          if (result.success && result.auth) {
            const auth = result.auth;
            const authStatus = {
              authenticated: auth.authenticated,
              method:
                auth.method === "oauth_token"
                  ? ("oauth" as const)
                  : auth.method?.includes("api_key")
                  ? ("api_key" as const)
                  : ("none" as const),
              hasCredentialsFile: auth.hasCredentialsFile ?? false,
              oauthTokenValid: auth.hasStoredOAuthToken,
              apiKeyValid: auth.hasStoredApiKey || auth.hasEnvApiKey,
            };
            setClaudeAuthStatus(authStatus);
          }
        } catch (error) {
          console.error("Failed to check Claude auth status:", error);
        }
      }

      // Check Codex auth status (re-fetch on mount to ensure persistence)
      if (api?.setup?.getCodexStatus) {
        try {
          const result = await api.setup.getCodexStatus();
          if (result.success && result.auth) {
            const auth = result.auth;
            // Determine method - prioritize cli_verified and cli_tokens over auth_file
            const method =
              auth.method === "cli_verified" || auth.method === "cli_tokens"
                ? auth.method === "cli_verified"
                  ? ("cli_verified" as const)
                  : ("cli_tokens" as const)
                : auth.method === "auth_file"
                ? ("api_key" as const)
                : auth.method === "env_var"
                ? ("env" as const)
                : ("none" as const);

            const authStatus = {
              authenticated: auth.authenticated,
              method,
              // Only set apiKeyValid for actual API key methods, not CLI login
              apiKeyValid:
                method === "cli_verified" || method === "cli_tokens"
                  ? undefined
                  : auth.hasAuthFile || auth.hasEnvKey,
            };
            setCodexAuthStatus(authStatus);
          }
        } catch (error) {
          console.error("Failed to check Codex auth status:", error);
        }
      }
    };

    checkCliStatus();
  }, [setClaudeAuthStatus, setCodexAuthStatus]);

  // Refresh Claude CLI status
  const handleRefreshClaudeCli = useCallback(async () => {
    setIsCheckingClaudeCli(true);
    try {
      const api = getElectronAPI();
      if (api?.checkClaudeCli) {
        const status = await api.checkClaudeCli();
        setClaudeCliStatus(status);
      }
    } catch (error) {
      console.error("Failed to refresh Claude CLI status:", error);
    } finally {
      setIsCheckingClaudeCli(false);
    }
  }, []);

  // Refresh Codex CLI status
  const handleRefreshCodexCli = useCallback(async () => {
    setIsCheckingCodexCli(true);
    try {
      const api = getElectronAPI();
      if (api?.checkCodexCli) {
        const status = await api.checkCodexCli();
        setCodexCliStatus(status);
      }
    } catch (error) {
      console.error("Failed to refresh Codex CLI status:", error);
    } finally {
      setIsCheckingCodexCli(false);
    }
  }, []);

  return {
    claudeCliStatus,
    codexCliStatus,
    isCheckingClaudeCli,
    isCheckingCodexCli,
    handleRefreshClaudeCli,
    handleRefreshCodexCli,
  };
}
