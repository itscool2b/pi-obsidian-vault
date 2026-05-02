import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createCommitTokenPolicy, type CreateCommitTokenPolicyInput } from "./commit-token.js";
import type { CommitTokenPolicy } from "./commit-token-types.js";
import { normalizeTrashFolderTarget } from "./path-safety.js";
import type { BudgetProfile } from "./retrieval-types.js";

const FALLBACK_CONFIG_PATH = ".pi/agent/obsidian-vault.json";

type ConfigFile = Record<string, unknown>;
type ConfigSource = "env" | "config" | "default";

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  configPath?: string | undefined;
}

export interface ConfigWarning {
  code: string;
  field: string;
  source: "env" | "config";
  message: string;
  fallbackUsed: boolean;
}

export interface StatusConfigSummary {
  tokenSupport: "enabled" | "disabled" | "unavailable";
  tokenRequirementMode: CommitTokenPolicy["requirementMode"];
  tokenTtlSeconds: number;
  defaultRetrieveBudget: BudgetProfile;
  defaultRelationshipBudget: BudgetProfile;
  maxPreviewChars: number;
  maxValidationIssues: number;
  defaultTrashFolder: string;
  writeDryRunValidationEnabled: boolean;
  appendDryRunValidationEnabled: boolean;
  configSource: string;
  warnings: string[];
}

export interface VaultConfig {
  vaultPathSource: "env" | "config" | "missing";
  rawVaultPath?: string | undefined;
  vaultRoot?: string | undefined;
  cliPath: string;
  cliTimeoutMs: number;
  autoLaunch: boolean;
  launchWaitMs: number;
  obsidianAppPath?: string | undefined;
  vaultTarget?: string | undefined;
  defaultBudget: BudgetProfile;
  defaultRetrieveBudget: BudgetProfile;
  defaultRelationshipBudget: BudgetProfile;
  budgetChars: Record<BudgetProfile, number>;
  maxPreviewChars: number;
  maxValidationIssues: number;
  defaultTrashFolder: string;
  commitTokensRequired: boolean;
  commitTokenTtlSeconds: number;
  commitTokenStrictMode: boolean;
  commitTokenPolicy: CommitTokenPolicy;
  writeDryRunValidationEnabled: boolean;
  appendDryRunValidationEnabled: boolean;
  configWarnings: ConfigWarning[];
  warnings: string[];
  errors: string[];
}

export interface VaultStatus {
  configured: boolean;
  source: VaultConfig["vaultPathSource"];
  vaultRoot?: string | undefined;
  cliPath: string;
  vaultTarget?: string | undefined;
  errors: string[];
}

export interface WriteVaultStatus {
  configured: boolean;
  source: VaultConfig["vaultPathSource"];
  vaultRoot?: string | undefined;
  writable: boolean;
  errors: string[];
  warnings: string[];
}

export interface EditVaultStatus {
  configured: boolean;
  source: VaultConfig["vaultPathSource"];
  status: "available" | "unavailable" | "degraded";
  errors: string[];
  warnings: string[];
}

export interface ManageVaultStatus {
  configured: boolean;
  source: VaultConfig["vaultPathSource"];
  status: "available" | "unavailable" | "degraded";
  errors: string[];
  warnings: string[];
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<VaultConfig> {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(homedir(), FALLBACK_CONFIG_PATH);
  const errors: string[] = [];
  const configWarnings: ConfigWarning[] = [];
  const fileConfig = await readConfigFile(configPath);
  const envVaultPath = env.OBSIDIAN_VAULT_PATH?.trim();
  const rawVaultPath = envVaultPath || stringFromConfig(fileConfig, "vaultPath");
  const vaultPathSource: VaultConfig["vaultPathSource"] = envVaultPath ? "env" : rawVaultPath ? "config" : "missing";
  const vaultTarget = env.OBSIDIAN_VAULT_ID?.trim()
    || env.OBSIDIAN_VAULT_NAME?.trim()
    || stringFromConfig(fileConfig, "vaultId")
    || stringFromConfig(fileConfig, "vaultName")
    || stringFromConfig(fileConfig, "vaultTarget")
    || undefined;

  let vaultRoot: string | undefined;
  if (rawVaultPath) {
    try {
      const resolved = await realpath(rawVaultPath);
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        errors.push("Configured vault path is not a directory.");
      } else {
        vaultRoot = resolved;
      }
    } catch (error) {
      errors.push("Configured vault path is not accessible.");
    }
  } else if (!vaultTarget) {
    errors.push(`Vault path is not configured. Set OBSIDIAN_VAULT_PATH, OBSIDIAN_VAULT_NAME, or OBSIDIAN_VAULT_ID, or create ~/${FALLBACK_CONFIG_PATH} with a local vaultPath.`);
  }

  const cliPath = env.OBSIDIAN_CLI_PATH?.trim() || stringFromConfig(fileConfig, "cliPath") || await defaultCliPath(env);
  const cliTimeoutMs = clampNumber(parseInteger(env.OBSIDIAN_CLI_TIMEOUT_MS) ?? integerFromConfig(fileConfig, "cliTimeoutMs"), 1_000, 60_000, 10_000);
  const autoLaunch = parseBoolean(env.OBSIDIAN_AUTO_LAUNCH) ?? booleanFromConfig(fileConfig, "autoLaunch") ?? false;
  const launchWaitMs = clampNumber(parseInteger(env.OBSIDIAN_LAUNCH_WAIT_MS) ?? integerFromConfig(fileConfig, "launchWaitMs"), 250, 15_000, 4_000);
  const obsidianAppPath = env.OBSIDIAN_APP_PATH?.trim() || stringFromConfig(fileConfig, "obsidianAppPath") || undefined;

  const defaultRetrieveBudget = budgetSetting({
    env,
    config: fileConfig,
    field: "defaultRetrieveBudget",
    envName: "OBSIDIAN_RETRIEVE_DEFAULT_BUDGET",
    fallback: "standard",
    warnings: configWarnings,
    aliases: ["defaultBudget"],
    envAliases: ["OBSIDIAN_RETRIEVE_BUDGET"],
  });
  const defaultRelationshipBudget = budgetSetting({ env, config: fileConfig, field: "defaultRelationshipBudget", envName: "OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET", fallback: "standard", warnings: configWarnings });

  const maxPreviewChars = integerSetting({ env, config: fileConfig, field: "maxPreviewChars", envName: "OBSIDIAN_MAX_PREVIEW_CHARS", min: 100, max: 12_000, fallback: 4_000, warnings: configWarnings });
  const maxValidationIssues = integerSetting({ env, config: fileConfig, field: "maxValidationIssues", envName: "OBSIDIAN_VALIDATE_MAX_ISSUES", min: 1, max: 100, fallback: 50, warnings: configWarnings });
  const defaultTrashFolder = trashFolderSetting({ env, config: fileConfig, field: "defaultTrashFolder", envName: "OBSIDIAN_TRASH_FOLDER", fallback: "_Trash", warnings: configWarnings });
  const commitTokensRequired = booleanSetting({ env, config: fileConfig, field: "commitTokensRequired", envName: "OBSIDIAN_COMMIT_TOKENS_REQUIRED", fallback: true, warnings: configWarnings });
  const commitTokenTtlSeconds = integerSetting({ env, config: fileConfig, field: "commitTokenTtlSeconds", envName: "OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS", min: 30, max: 3_600, fallback: 300, warnings: configWarnings });
  const commitTokenStrictMode = booleanSetting({ env, config: fileConfig, field: "commitTokenStrictMode", envName: "OBSIDIAN_COMMIT_TOKEN_STRICT_MODE", fallback: false, warnings: configWarnings });
  const writeDryRunValidationEnabled = booleanSetting({ env, config: fileConfig, field: "writeDryRunValidationEnabled", envName: "OBSIDIAN_WRITE_DRY_RUN_VALIDATION_ENABLED", fallback: true, warnings: configWarnings });
  const appendDryRunValidationEnabled = booleanSetting({ env, config: fileConfig, field: "appendDryRunValidationEnabled", envName: "OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED", fallback: true, warnings: configWarnings });

  configWarnings.push(...unsafeConfigWarnings(fileConfig));

  const budgetChars: Record<BudgetProfile, number> = {
    tiny: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_TINY_CHARS), 1_000, 12_000, 3_500),
    standard: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_STANDARD_CHARS), 2_000, 12_000, 8_000),
    expanded: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_EXPANDED_CHARS), 4_000, 12_000, 12_000),
  };

  const policyInput: CreateCommitTokenPolicyInput = { tokensRequired: commitTokensRequired, strictMode: commitTokenStrictMode, ttlSeconds: commitTokenTtlSeconds };
  const commitTokenPolicy = createCommitTokenPolicy(policyInput);
  const warnings = configWarnings.map((warning) => warning.message);

  const config: VaultConfig = {
    vaultPathSource,
    cliPath,
    cliTimeoutMs,
    autoLaunch,
    launchWaitMs,
    defaultBudget: defaultRetrieveBudget,
    defaultRetrieveBudget,
    defaultRelationshipBudget,
    budgetChars,
    maxPreviewChars,
    maxValidationIssues,
    defaultTrashFolder,
    commitTokensRequired,
    commitTokenTtlSeconds,
    commitTokenStrictMode,
    commitTokenPolicy,
    writeDryRunValidationEnabled,
    appendDryRunValidationEnabled,
    configWarnings,
    warnings,
    errors,
  };
  if (rawVaultPath) config.rawVaultPath = rawVaultPath;
  if (vaultRoot) config.vaultRoot = vaultRoot;
  if (vaultTarget) config.vaultTarget = vaultTarget;
  if (obsidianAppPath) config.obsidianAppPath = obsidianAppPath;
  return config;
}

export function statusFromConfig(config: VaultConfig): VaultStatus {
  const status: VaultStatus = {
    configured: Boolean(config.vaultRoot || config.vaultTarget),
    source: config.vaultPathSource,
    cliPath: config.cliPath,
    errors: config.errors,
  };
  if (config.vaultRoot) status.vaultRoot = config.vaultRoot;
  if (config.vaultTarget) status.vaultTarget = config.vaultTarget;
  return status;
}

export function statusConfigSummary(config: VaultConfig, tokenServiceAvailable = true): StatusConfigSummary {
  const tokenSupport: StatusConfigSummary["tokenSupport"] = !config.commitTokensRequired ? "disabled" : tokenServiceAvailable ? "enabled" : "unavailable";
  return {
    tokenSupport,
    tokenRequirementMode: config.commitTokenPolicy.requirementMode,
    tokenTtlSeconds: config.commitTokenTtlSeconds,
    defaultRetrieveBudget: config.defaultRetrieveBudget,
    defaultRelationshipBudget: config.defaultRelationshipBudget,
    maxPreviewChars: config.maxPreviewChars,
    maxValidationIssues: config.maxValidationIssues,
    defaultTrashFolder: config.defaultTrashFolder,
    writeDryRunValidationEnabled: config.writeDryRunValidationEnabled,
    appendDryRunValidationEnabled: config.appendDryRunValidationEnabled,
    configSource: configSourceLabel(config),
    warnings: config.warnings,
  };
}

export async function writeStatusFromConfig(config: VaultConfig): Promise<WriteVaultStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.vaultRoot) {
    if (config.vaultTarget) warnings.push("Writes require a local vaultPath; vault name/id targets are retrieval-only for obsidian_write.");
    errors.push("Local vault path is required for obsidian_write. Set OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json vaultPath.");
    return { configured: false, source: config.vaultPathSource, writable: false, errors, warnings };
  }
  try {
    await access(config.vaultRoot, fsConstants.W_OK);
  } catch {
    errors.push("Configured vault path is not writable for obsidian_write.");
  }
  const status: WriteVaultStatus = { configured: true, source: config.vaultPathSource, vaultRoot: config.vaultRoot, writable: errors.length === 0, errors, warnings };
  return status;
}

export async function editStatusFromConfig(config: VaultConfig): Promise<EditVaultStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.vaultRoot) {
    if (config.vaultTarget) warnings.push("obsidian_edit requires a local vaultPath; vault name/id targets are retrieval-only.");
    errors.push("Local vault path is required for obsidian_edit. Set OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json vaultPath.");
    return { configured: false, source: config.vaultPathSource, status: "unavailable", errors, warnings };
  }
  try {
    await access(config.vaultRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    errors.push("Configured vault path is not readable and writable for obsidian_edit.");
  }
  return { configured: true, source: config.vaultPathSource, status: errors.length === 0 ? "available" : "degraded", errors, warnings };
}

export async function manageStatusFromConfig(config: VaultConfig): Promise<ManageVaultStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.vaultRoot) {
    if (config.vaultTarget) warnings.push("obsidian_manage requires a local vaultPath; vault name/id targets are retrieval-only.");
    errors.push("Local vault path is required for obsidian_manage. Set OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json vaultPath.");
    return { configured: false, source: config.vaultPathSource, status: "unavailable", errors, warnings };
  }
  try {
    await access(config.vaultRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    errors.push("Configured vault path is not readable and writable for obsidian_manage.");
  }
  return { configured: true, source: config.vaultPathSource, status: errors.length === 0 ? "available" : "degraded", errors, warnings };
}

async function readConfigFile(configPath: string): Promise<ConfigFile> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ConfigFile : {};
  } catch {
    // Missing fallback config is normal. Surface an actionable vault error separately.
    return {};
  }
}

async function defaultCliPath(env: Record<string, string | undefined>): Promise<string> {
  return await executableInPath("obsidian-cli", env.PATH) ? "obsidian-cli" : "obsidian";
}

async function executableInPath(binary: string, pathValue: string | undefined): Promise<boolean> {
  if (!pathValue) return false;
  const names = process.platform === "win32" ? [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`] : [binary];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      try {
        await access(path.join(directory, name), fsConstants.X_OK);
        return true;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return false;
}

function configSourceLabel(config: VaultConfig): string {
  if (config.vaultPathSource === "env") return "env/default";
  if (config.vaultPathSource === "config") return "config/default";
  return "default";
}

function stringFromConfig(config: ConfigFile, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function integerFromConfig(config: ConfigFile, key: string): number | undefined {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return typeof value === "string" ? parseInteger(value) : undefined;
}

function booleanFromConfig(config: ConfigFile, key: string): boolean | undefined {
  const value = config[key];
  if (typeof value === "boolean") return value;
  return typeof value === "string" ? parseBoolean(value) : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (!/^[+-]?\d+$/.test(value.trim())) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseBudget(value: string | undefined): BudgetProfile | undefined {
  if (value === "tiny" || value === "standard" || value === "expanded") return value;
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function sourceValue(input: { env: Record<string, string | undefined>; config: ConfigFile; field: string; envName: string; aliases?: string[] | undefined; envAliases?: string[] | undefined }): { value: unknown; source: ConfigSource } {
  const envCandidates = [input.envName, ...(input.envAliases ?? [])];
  for (const name of envCandidates) {
    const raw = input.env[name];
    if (raw !== undefined && raw.trim() !== "") return { value: raw, source: "env" };
  }
  const configCandidates = [input.field, ...(input.aliases ?? [])];
  for (const key of configCandidates) {
    if (input.config[key] !== undefined) return { value: input.config[key], source: "config" };
  }
  return { value: undefined, source: "default" };
}

function budgetSetting(input: { env: Record<string, string | undefined>; config: ConfigFile; field: string; envName: string; fallback: BudgetProfile; warnings: ConfigWarning[]; aliases?: string[] | undefined; envAliases?: string[] | undefined }): BudgetProfile {
  const selected = sourceValue(input);
  if (selected.value === undefined) return input.fallback;
  const parsed = parseBudget(String(selected.value).trim());
  if (parsed) return parsed;
  pushWarning(input.warnings, {
    code: "INVALID_BUDGET",
    field: input.field,
    source: selected.source === "env" ? "env" : "config",
    message: `Invalid ${input.field} value from ${selected.source}; using safe default ${input.fallback}.`,
    fallbackUsed: true,
  });
  return input.fallback;
}

function integerSetting(input: { env: Record<string, string | undefined>; config: ConfigFile; field: string; envName: string; min: number; max: number; fallback: number; warnings: ConfigWarning[] }): number {
  const selected = sourceValue(input);
  if (selected.value === undefined) return input.fallback;
  const parsed = typeof selected.value === "number" && Number.isFinite(selected.value)
    ? Math.trunc(selected.value)
    : typeof selected.value === "string"
      ? parseInteger(selected.value)
      : undefined;
  if (parsed !== undefined && parsed >= input.min && parsed <= input.max) return parsed;
  pushWarning(input.warnings, {
    code: "INVALID_INTEGER",
    field: input.field,
    source: selected.source === "env" ? "env" : "config",
    message: `Invalid ${input.field} value from ${selected.source}; using safe default ${input.fallback}.`,
    fallbackUsed: true,
  });
  return input.fallback;
}

function booleanSetting(input: { env: Record<string, string | undefined>; config: ConfigFile; field: string; envName: string; fallback: boolean; warnings: ConfigWarning[] }): boolean {
  const selected = sourceValue(input);
  if (selected.value === undefined) return input.fallback;
  const parsed = typeof selected.value === "boolean"
    ? selected.value
    : typeof selected.value === "string"
      ? parseBoolean(selected.value)
      : undefined;
  if (parsed !== undefined) return parsed;
  pushWarning(input.warnings, {
    code: "INVALID_BOOLEAN",
    field: input.field,
    source: selected.source === "env" ? "env" : "config",
    message: `Invalid ${input.field} value from ${selected.source}; using safe default ${input.fallback}.`,
    fallbackUsed: true,
  });
  return input.fallback;
}

function trashFolderSetting(input: { env: Record<string, string | undefined>; config: ConfigFile; field: string; envName: string; fallback: string; warnings: ConfigWarning[] }): string {
  const selected = sourceValue(input);
  if (selected.value === undefined) return input.fallback;
  if (typeof selected.value === "string") {
    try {
      return normalizeTrashFolderTarget(selected.value.trim());
    } catch {
      // Fall through to redacted warning and safe fallback.
    }
  }
  pushWarning(input.warnings, {
    code: "INVALID_TRASH_FOLDER",
    field: input.field,
    source: selected.source === "env" ? "env" : "config",
    message: `Invalid ${input.field} value from ${selected.source}; using safe default trash folder.`,
    fallbackUsed: true,
  });
  return input.fallback;
}

function unsafeConfigWarnings(config: ConfigFile): ConfigWarning[] {
  const unsafeKeys = [
    "allowOverwrite",
    "allowDelete",
    "allowPermanentDelete",
    "allowFolderDelete",
    "allowRecursive",
    "allowWildcards",
    "allowLinkRewrite",
    "allowShell",
    "allowNetwork",
    "allowUiOpen",
    "disablePathSafety",
    "disableTokens",
  ];
  const warnings: ConfigWarning[] = [];
  for (const key of unsafeKeys) {
    if (config[key] === undefined) continue;
    warnings.push({
      code: "UNSAFE_CONFIG_IGNORED",
      field: key,
      source: "config",
      message: `Unsupported unsafe config field ${key} is ignored; safety restrictions remain enforced.`,
      fallbackUsed: true,
    });
  }
  return warnings;
}

function pushWarning(warnings: ConfigWarning[], warning: ConfigWarning): void {
  warnings.push(warning);
}
