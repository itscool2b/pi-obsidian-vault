import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BudgetProfile } from "./retrieval-types.js";
import { detectObsidianVault } from "./vault-auto-detect.js";

const FALLBACK_CONFIG_PATH = ".pi/agent/obsidian-vault.json";

export const OBSIDIAN_DEFAULT_RETRIEVE_BUDGET: BudgetProfile = "expanded";
export const OBSIDIAN_DEFAULT_RELATIONSHIP_BUDGET: BudgetProfile = "expanded";
export const OBSIDIAN_DEFAULT_BUDGET_CHARS: Record<BudgetProfile, number> = {
  tiny: 3_500,
  standard: 8_000,
  expanded: 80_000,
};
export const OBSIDIAN_MAX_PREVIEW_CHARS = 100_000;
export const OBSIDIAN_MAX_VALIDATION_ISSUES = 50;
export const OBSIDIAN_DEFAULT_TRASH_FOLDER = "_Trash";

interface ConfigFile {
  vaultPath?: unknown;
}

export interface LoadConfigOptions {
  /** Hidden test/dev override. Normal users should use /obsidian-vault set-vault or auto-detection. */
  env?: Record<string, string | undefined>;
  /** Hidden test/dev override for where the single remembered vaultPath is stored. */
  configPath?: string | undefined;
  obsidianDesktopConfigPath?: string | undefined;
  homeDir?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  autoDetectVault?: boolean | undefined;
}

export interface VaultConfig {
  vaultPathSource: "env" | "remembered" | "auto" | "missing";
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
  writeDryRunValidationEnabled: boolean;
  appendDryRunValidationEnabled: boolean;
  warnings: string[];
  errors: string[];
}

export interface VaultStatus {
  configured: boolean;
  source: VaultConfig["vaultPathSource"];
  vaultRoot?: string | undefined;
  cliPath: string;
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

export interface VaultConfigMutationResult {
  status: "success" | "missing" | "invalid" | "error";
  operation: "set_vault" | "forget_vault" | "status";
  vaultState: "remembered" | "auto-detected" | "missing" | "env-override";
  message: string;
  remembered: boolean;
  configured: boolean;
  warnings: string[];
  errors: string[];
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<VaultConfig> {
  const env = options.env ?? process.env;
  const configPath = configPathForOptions(options);
  const fileConfig = await readConfigFile(configPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const envVaultPath = env.OBSIDIAN_VAULT_PATH?.trim();
  const rememberedVaultPath = stringFromConfig(fileConfig, "vaultPath");
  let rawVaultPath = envVaultPath || rememberedVaultPath;
  let vaultPathSource: VaultConfig["vaultPathSource"] = envVaultPath ? "env" : rememberedVaultPath ? "remembered" : "missing";
  let vaultRoot: string | undefined;

  if (rawVaultPath) {
    const resolved = await resolveExistingDirectory(rawVaultPath);
    if (resolved.ok) vaultRoot = resolved.path;
    else errors.push(vaultPathSource === "env" ? "The vault path override is not an accessible folder." : "The remembered vault path is not an accessible folder. Tell me the vault folder path again and I can remember it.");
  }

  if (!vaultRoot) {
    const shouldAutoDetect = options.autoDetectVault ?? true;
    const detected = shouldAutoDetect ? await detectObsidianVault({ env, configPath: options.obsidianDesktopConfigPath, homeDir: options.homeDir, platform: options.platform }) : undefined;
    if (detected?.vaultRoot) {
      rawVaultPath = detected.vaultRoot;
      vaultRoot = detected.vaultRoot;
      vaultPathSource = "auto";
      warnings.push(...detected.warnings);
    } else if (!rawVaultPath) {
      errors.push("I couldn't find your Obsidian vault. Tell me the vault folder path and I can remember it.");
    }
  }

  const config: VaultConfig = {
    vaultPathSource,
    cliPath: await defaultCliPath(env),
    cliTimeoutMs: 10_000,
    autoLaunch: false,
    launchWaitMs: 4_000,
    defaultBudget: OBSIDIAN_DEFAULT_RETRIEVE_BUDGET,
    defaultRetrieveBudget: OBSIDIAN_DEFAULT_RETRIEVE_BUDGET,
    defaultRelationshipBudget: OBSIDIAN_DEFAULT_RELATIONSHIP_BUDGET,
    budgetChars: OBSIDIAN_DEFAULT_BUDGET_CHARS,
    maxPreviewChars: OBSIDIAN_MAX_PREVIEW_CHARS,
    maxValidationIssues: OBSIDIAN_MAX_VALIDATION_ISSUES,
    defaultTrashFolder: OBSIDIAN_DEFAULT_TRASH_FOLDER,
    writeDryRunValidationEnabled: true,
    appendDryRunValidationEnabled: true,
    warnings,
    errors,
  };
  if (rawVaultPath) config.rawVaultPath = rawVaultPath;
  if (vaultRoot) config.vaultRoot = vaultRoot;
  return config;
}

export async function setRememberedVaultPath(vaultPath: string, options: LoadConfigOptions = {}): Promise<VaultConfigMutationResult> {
  const trimmed = vaultPath.trim();
  if (!trimmed) {
    return configMutationResult("set_vault", "invalid", false, false, "Provide the Obsidian vault folder path to remember.", [], ["Missing vault path."]);
  }
  const resolved = await resolveExistingDirectory(trimmed);
  if (!resolved.ok) {
    return configMutationResult("set_vault", "invalid", false, false, "That path is not an accessible folder. No vault path was remembered.", [], [resolved.message]);
  }
  try {
    await writeConfigFile(configPathForOptions(options), { vaultPath: resolved.path });
    return configMutationResult("set_vault", "success", true, true, "Remembered this Obsidian vault for future Pi sessions.", [], []);
  } catch {
    return configMutationResult("set_vault", "error", false, false, "I couldn't save the remembered vault path.", [], ["Config write failed."]);
  }
}

export async function forgetRememberedVaultPath(options: LoadConfigOptions = {}): Promise<VaultConfigMutationResult> {
  try {
    await writeConfigFile(configPathForOptions(options), {});
    const config = await loadConfig(options);
    return configMutationResult("forget_vault", "success", false, Boolean(config.vaultRoot), config.vaultRoot ? "Forgot the remembered vault path. Auto-detection is currently available." : "Forgot the remembered vault path. I will use auto-detection next, or ask for a vault path if needed.", config.warnings, config.errors);
  } catch {
    return configMutationResult("forget_vault", "error", false, false, "I couldn't update the remembered vault path.", [], ["Config write failed."]);
  }
}

export async function rememberedVaultStatus(options: LoadConfigOptions = {}): Promise<VaultConfigMutationResult> {
  const config = await loadConfig(options);
  const remembered = config.vaultPathSource === "remembered";
  const source = vaultState(config);
  const message = config.vaultRoot
    ? `Obsidian vault is ready (${source}).`
    : "Obsidian vault setup is needed. Tell me the vault folder path and I can remember it.";
  return configMutationResult("status", config.vaultRoot ? "success" : "missing", remembered, Boolean(config.vaultRoot), message, config.warnings, config.errors, source);
}

export function statusFromConfig(config: VaultConfig): VaultStatus {
  const status: VaultStatus = {
    configured: Boolean(config.vaultRoot),
    source: config.vaultPathSource,
    cliPath: config.cliPath,
    errors: config.errors,
  };
  if (config.vaultRoot) status.vaultRoot = config.vaultRoot;
  return status;
}

export async function writeStatusFromConfig(config: VaultConfig): Promise<WriteVaultStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.vaultRoot) {
    errors.push("Local vault path is required. Tell me your Obsidian vault folder path and I can remember it.");
    return { configured: false, source: config.vaultPathSource, writable: false, errors, warnings };
  }
  try {
    await access(config.vaultRoot, fsConstants.W_OK);
  } catch {
    errors.push("The Obsidian vault folder is not writable.");
  }
  return { configured: true, source: config.vaultPathSource, vaultRoot: config.vaultRoot, writable: errors.length === 0, errors, warnings };
}

export async function editStatusFromConfig(config: VaultConfig): Promise<EditVaultStatus> {
  return readWriteStatus(config, "edit");
}

export async function manageStatusFromConfig(config: VaultConfig): Promise<ManageVaultStatus> {
  return readWriteStatus(config, "manage");
}

async function readWriteStatus(config: VaultConfig, _kind: "edit" | "manage"): Promise<EditVaultStatus | ManageVaultStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.vaultRoot) {
    errors.push("Local vault path is required. Tell me your Obsidian vault folder path and I can remember it.");
    return { configured: false, source: config.vaultPathSource, status: "unavailable", errors, warnings };
  }
  try {
    await access(config.vaultRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    errors.push("The Obsidian vault folder is not readable and writable.");
  }
  return { configured: true, source: config.vaultPathSource, status: errors.length === 0 ? "available" : "degraded", errors, warnings };
}

function configPathForOptions(options: LoadConfigOptions): string {
  return options.configPath ?? path.join(options.homeDir ?? homedir(), FALLBACK_CONFIG_PATH);
}

async function readConfigFile(configPath: string): Promise<ConfigFile> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ConfigFile : {};
  } catch {
    return {};
  }
}

async function writeConfigFile(configPath: string, config: ConfigFile): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function stringFromConfig(config: ConfigFile, key: keyof ConfigFile): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

async function resolveExistingDirectory(input: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  try {
    const resolved = await realpath(input);
    const info = await stat(resolved);
    if (!info.isDirectory()) return { ok: false, message: "Path exists but is not a folder." };
    return { ok: true, path: resolved };
  } catch {
    return { ok: false, message: "Path is not accessible." };
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

function vaultState(config: VaultConfig): VaultConfigMutationResult["vaultState"] {
  if (config.vaultPathSource === "env") return "env-override";
  if (config.vaultPathSource === "remembered") return "remembered";
  if (config.vaultPathSource === "auto") return "auto-detected";
  return "missing";
}

function configMutationResult(
  operation: VaultConfigMutationResult["operation"],
  status: VaultConfigMutationResult["status"],
  remembered: boolean,
  configured: boolean,
  message: string,
  warnings: string[],
  errors: string[],
  vaultStateValue?: VaultConfigMutationResult["vaultState"],
): VaultConfigMutationResult {
  return {
    status,
    operation,
    vaultState: vaultStateValue ?? (remembered ? "remembered" : configured ? "auto-detected" : "missing"),
    message,
    remembered,
    configured,
    warnings,
    errors,
  };
}
