import { useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Terminal,
  Info,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { getHttpApiClient } from '@/lib/http-api-client';
import { useAppStore } from '@/store/app-store';
import { useSetupStore } from '@/store/setup-store';
import { cn } from '@/lib/utils';
import type { CursorModelId, CursorModelConfig, CursorPermissionProfile } from '@automaker/types';
import { CURSOR_MODEL_MAP } from '@automaker/types';
import {
  CursorCliStatus,
  CursorCliStatusSkeleton,
  ModelConfigSkeleton,
} from '../cli-status/cursor-cli-status';

interface CursorStatus {
  installed: boolean;
  version?: string;
  authenticated: boolean;
  method?: string;
}

interface PermissionsData {
  activeProfile: CursorPermissionProfile | null;
  effectivePermissions: { allow: string[]; deny: string[] } | null;
  hasProjectConfig: boolean;
  availableProfiles: Array<{
    id: string;
    name: string;
    description: string;
    permissions: { allow: string[]; deny: string[] };
  }>;
}

export function CursorSettingsTab() {
  // Global settings from store
  const {
    enabledCursorModels,
    cursorDefaultModel,
    setCursorDefaultModel,
    toggleCursorModel,
    currentProject,
  } = useAppStore();
  const { setCursorCliStatus } = useSetupStore();

  const [status, setStatus] = useState<CursorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionsData | null>(null);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  // All available models from the model map
  const availableModels: CursorModelConfig[] = Object.values(CURSOR_MODEL_MAP);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const api = getHttpApiClient();
      const statusResult = await api.setup.getCursorStatus();

      if (statusResult.success) {
        const newStatus = {
          installed: statusResult.installed ?? false,
          version: statusResult.version ?? undefined,
          authenticated: statusResult.auth?.authenticated ?? false,
          method: statusResult.auth?.method,
        };
        setStatus(newStatus);

        // Also update the global setup store so other components can access the status
        setCursorCliStatus({
          installed: newStatus.installed,
          version: newStatus.version,
          auth: newStatus.authenticated
            ? {
                authenticated: true,
                method: newStatus.method || 'unknown',
              }
            : undefined,
        });
      }
    } catch (error) {
      console.error('Failed to load Cursor settings:', error);
      toast.error('Failed to load Cursor settings');
    } finally {
      setIsLoading(false);
    }
  }, [setCursorCliStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDefaultModelChange = (model: CursorModelId) => {
    setIsSaving(true);
    try {
      setCursorDefaultModel(model);
      toast.success('Default model updated');
    } catch (error) {
      toast.error('Failed to update default model');
    } finally {
      setIsSaving(false);
    }
  };

  const handleModelToggle = (model: CursorModelId, enabled: boolean) => {
    setIsSaving(true);
    try {
      toggleCursorModel(model, enabled);
    } catch (error) {
      toast.error('Failed to update models');
    } finally {
      setIsSaving(false);
    }
  };

  // Load permissions data
  const loadPermissions = useCallback(async () => {
    setIsLoadingPermissions(true);
    try {
      const api = getHttpApiClient();
      const result = await api.setup.getCursorPermissions(currentProject?.path);

      if (result.success) {
        setPermissions({
          activeProfile: result.activeProfile || null,
          effectivePermissions: result.effectivePermissions || null,
          hasProjectConfig: result.hasProjectConfig || false,
          availableProfiles: result.availableProfiles || [],
        });
      }
    } catch (error) {
      console.error('Failed to load Cursor permissions:', error);
    } finally {
      setIsLoadingPermissions(false);
    }
  }, [currentProject?.path]);

  // Load permissions when tab is expanded
  useEffect(() => {
    if (permissionsExpanded && status?.installed && !permissions) {
      loadPermissions();
    }
  }, [permissionsExpanded, status?.installed, permissions, loadPermissions]);

  // Apply a permission profile
  const handleApplyProfile = async (
    profileId: 'strict' | 'development',
    scope: 'global' | 'project'
  ) => {
    setIsSavingPermissions(true);
    try {
      const api = getHttpApiClient();
      const result = await api.setup.applyCursorPermissionProfile(
        profileId,
        scope,
        scope === 'project' ? currentProject?.path : undefined
      );

      if (result.success) {
        toast.success(result.message || `Applied ${profileId} profile`);
        await loadPermissions();
      } else {
        toast.error(result.error || 'Failed to apply profile');
      }
    } catch (error) {
      toast.error('Failed to apply profile');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  // Copy example config to clipboard
  const handleCopyConfig = async (profileId: 'strict' | 'development') => {
    try {
      const api = getHttpApiClient();
      const result = await api.setup.getCursorExampleConfig(profileId);

      if (result.success && result.config) {
        await navigator.clipboard.writeText(result.config);
        setCopiedConfig(true);
        toast.success('Config copied to clipboard');
        setTimeout(() => setCopiedConfig(false), 2000);
      }
    } catch (error) {
      toast.error('Failed to copy config');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Usage Info skeleton */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-400/90">
            <span className="font-medium">Board View Only</span>
            <p className="text-xs text-amber-400/70 mt-1">
              Cursor is currently only available for the Kanban board agent tasks.
            </p>
          </div>
        </div>
        <CursorCliStatusSkeleton />
        <ModelConfigSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Usage Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-400/90">
          <span className="font-medium">Board View Only</span>
          <p className="text-xs text-amber-400/70 mt-1">
            Cursor is currently only available for the Kanban board agent tasks.
          </p>
        </div>
      </div>

      {/* CLI Status */}
      <CursorCliStatus status={status} isChecking={isLoading} onRefresh={loadData} />

      {/* Model Configuration - Always show (global settings) */}
      {status?.installed && (
        <div
          className={cn(
            'rounded-2xl overflow-hidden',
            'border border-border/50',
            'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
            'shadow-sm shadow-black/5'
          )}
        >
          <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
                <Terminal className="w-5 h-5 text-brand-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                Model Configuration
              </h2>
            </div>
            <p className="text-sm text-muted-foreground/80 ml-12">
              Configure which Cursor models are available in the feature modal
            </p>
          </div>
          <div className="p-6 space-y-6">
            {/* Default Model */}
            <div className="space-y-2">
              <Label>Default Model</Label>
              <Select
                value={cursorDefaultModel}
                onValueChange={(v) => handleDefaultModelChange(v as CursorModelId)}
                disabled={isSaving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledCursorModels.map((modelId) => {
                    const model = CURSOR_MODEL_MAP[modelId];
                    if (!model) return null;
                    return (
                      <SelectItem key={modelId} value={modelId}>
                        <div className="flex items-center gap-2">
                          <span>{model.label}</span>
                          {model.hasThinking && (
                            <Badge variant="outline" className="text-xs">
                              Thinking
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Enabled Models */}
            <div className="space-y-3">
              <Label>Available Models</Label>
              <div className="grid gap-3">
                {availableModels.map((model) => {
                  const isEnabled = enabledCursorModels.includes(model.id);
                  const isAuto = model.id === 'auto';

                  return (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card/50 hover:bg-accent/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isEnabled}
                          onCheckedChange={(checked) => handleModelToggle(model.id, !!checked)}
                          disabled={isSaving || isAuto}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{model.label}</span>
                            {model.hasThinking && (
                              <Badge variant="outline" className="text-xs">
                                Thinking
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{model.description}</p>
                        </div>
                      </div>
                      <Badge variant={model.tier === 'free' ? 'default' : 'secondary'}>
                        {model.tier}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CLI Permissions Section */}
      {status?.installed && (
        <Collapsible open={permissionsExpanded} onOpenChange={setPermissionsExpanded}>
          <div
            className={cn(
              'rounded-2xl overflow-hidden',
              'border border-border/50',
              'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
              'shadow-sm shadow-black/5'
            )}
          >
            <CollapsibleTrigger className="w-full">
              <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 flex items-center justify-center border border-amber-500/20">
                    <Shield className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-foreground tracking-tight">
                      CLI Permissions
                    </h2>
                    <p className="text-sm text-muted-foreground/80">
                      Configure what Cursor CLI can do
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {permissions?.activeProfile && (
                    <Badge
                      variant="outline"
                      className={cn(
                        permissions.activeProfile === 'strict'
                          ? 'border-green-500/50 text-green-500'
                          : permissions.activeProfile === 'development'
                            ? 'border-blue-500/50 text-blue-500'
                            : 'border-amber-500/50 text-amber-500'
                      )}
                    >
                      {permissions.activeProfile === 'strict' && (
                        <ShieldCheck className="w-3 h-3 mr-1" />
                      )}
                      {permissions.activeProfile === 'development' && (
                        <ShieldAlert className="w-3 h-3 mr-1" />
                      )}
                      {permissions.activeProfile}
                    </Badge>
                  )}
                  <ChevronDown
                    className={cn(
                      'w-5 h-5 text-muted-foreground transition-transform',
                      permissionsExpanded && 'rotate-180'
                    )}
                  />
                </div>
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="p-6 space-y-6">
                {/* Security Warning */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-400/90">
                    <span className="font-medium">Security Notice</span>
                    <p className="text-xs text-amber-400/70 mt-1">
                      Cursor CLI can execute shell commands based on its permission config. For
                      overnight automation, consider using the Strict profile to limit what commands
                      can run.
                    </p>
                  </div>
                </div>

                {isLoadingPermissions ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
                  </div>
                ) : (
                  <>
                    {/* Permission Profiles */}
                    <div className="space-y-3">
                      <Label>Permission Profiles</Label>
                      <div className="grid gap-3">
                        {permissions?.availableProfiles.map((profile) => (
                          <div
                            key={profile.id}
                            className={cn(
                              'p-4 rounded-xl border transition-colors',
                              permissions.activeProfile === profile.id
                                ? 'border-brand-500/50 bg-brand-500/5'
                                : 'border-border/50 bg-card/50 hover:bg-accent/30'
                            )}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {profile.id === 'strict' ? (
                                    <ShieldCheck className="w-4 h-4 text-green-500" />
                                  ) : (
                                    <ShieldAlert className="w-4 h-4 text-blue-500" />
                                  )}
                                  <span className="font-medium">{profile.name}</span>
                                  {permissions.activeProfile === profile.id && (
                                    <Badge variant="secondary" className="text-xs">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mb-2">
                                  {profile.description}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="text-green-500">
                                    {profile.permissions.allow.length} allowed
                                  </span>
                                  <span className="text-muted-foreground/50">|</span>
                                  <span className="text-red-500">
                                    {profile.permissions.deny.length} denied
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-2">
                                <Button
                                  size="sm"
                                  variant={
                                    permissions.activeProfile === profile.id
                                      ? 'secondary'
                                      : 'default'
                                  }
                                  disabled={
                                    isSavingPermissions || permissions.activeProfile === profile.id
                                  }
                                  onClick={() =>
                                    handleApplyProfile(
                                      profile.id as 'strict' | 'development',
                                      'global'
                                    )
                                  }
                                >
                                  Apply Globally
                                </Button>
                                {currentProject && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isSavingPermissions}
                                    onClick={() =>
                                      handleApplyProfile(
                                        profile.id as 'strict' | 'development',
                                        'project'
                                      )
                                    }
                                  >
                                    Apply to Project
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Config File Location */}
                    <div className="space-y-3">
                      <Label>Config File Locations</Label>
                      <div className="p-4 rounded-xl border border-border/50 bg-card/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">Global Config</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              ~/.cursor/cli-config.json
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyConfig('development')}
                          >
                            {copiedConfig ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <div className="border-t border-border/30 pt-2">
                          <p className="text-sm font-medium">Project Config</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            &lt;project&gt;/.cursor/cli.json
                          </p>
                          {permissions?.hasProjectConfig && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              Project override active
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Documentation Link */}
                    <div className="text-xs text-muted-foreground">
                      Learn more about{' '}
                      <a
                        href="https://cursor.com/docs/cli/reference/permissions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-500 hover:underline"
                      >
                        Cursor CLI permissions
                      </a>
                    </div>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}
    </div>
  );
}

export default CursorSettingsTab;
