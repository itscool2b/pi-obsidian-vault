import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BudgetProfile } from "./retrieval-types.js";

const FALLBACK_CONFIG_PATH = ".pi/agent/obsidian-vault.json";

type ConfigFile = Record<string, unknown>;

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  configPath?: string | undefined;
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
  budgetChars: Record<BudgetProfile, number>;
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
        errors.push(`Vault path is not a directory: ${rawVaultPath}`);
      } else {
        vaultRoot = resolved;
      }
    } catch (error) {
      errors.push(`Vault path is not accessible: ${rawVaultPath} (${error instanceof Error ? error.message : String(error)})`);
    }
  } else if (!vaultTarget) {
    errors.push(`Vault path is not configured. Set OBSIDIAN_VAULT_PATH, OBSIDIAN_VAULT_NAME, or OBSIDIAN_VAULT_ID, or create ~/${FALLBACK_CONFIG_PATH} with { "vaultPath": "/absolute/path/to/vault" }.`);
  }

  const cliPath = env.OBSIDIAN_CLI_PATH?.trim() || stringFromConfig(fileConfig, "cliPath") || await defaultCliPath(env);
  const cliTimeoutMs = clampNumber(parseInteger(env.OBSIDIAN_CLI_TIMEOUT_MS) ?? integerFromConfig(fileConfig, "cliTimeoutMs"), 1_000, 60_000, 10_000);
  const autoLaunch = parseBoolean(env.OBSIDIAN_AUTO_LAUNCH) ?? booleanFromConfig(fileConfig, "autoLaunch") ?? false;
  const launchWaitMs = clampNumber(parseInteger(env.OBSIDIAN_LAUNCH_WAIT_MS) ?? integerFromConfig(fileConfig, "launchWaitMs"), 250, 15_000, 4_000);
  const obsidianAppPath = env.OBSIDIAN_APP_PATH?.trim() || stringFromConfig(fileConfig, "obsidianAppPath") || undefined;
  const defaultBudget = parseBudget(env.OBSIDIAN_RETRIEVE_BUDGET) ?? parseBudget(stringFromConfig(fileConfig, "defaultBudget")) ?? "standard";
  const budgetChars: Record<BudgetProfile, number> = {
    tiny: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_TINY_CHARS), 1_000, 12_000, 3_500),
    standard: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_STANDARD_CHARS), 2_000, 12_000, 8_000),
    expanded: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_EXPANDED_CHARS), 4_000, 12_000, 12_000),
  };

  const config: VaultConfig = { vaultPathSource, cliPath, cliTimeoutMs, autoLaunch, launchWaitMs, defaultBudget, budgetChars, errors };
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
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
