import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BudgetProfile } from "./retrieval-types.js";

const FALLBACK_CONFIG_PATH = ".pi/agent/obsidian-vault.json";

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

export async function loadConfig(options: LoadConfigOptions = {}): Promise<VaultConfig> {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(homedir(), FALLBACK_CONFIG_PATH);
  const errors: string[] = [];
  const vaultTarget = env.OBSIDIAN_VAULT_ID?.trim() || env.OBSIDIAN_VAULT_NAME?.trim() || undefined;

  let rawVaultPath = env.OBSIDIAN_VAULT_PATH?.trim();
  let vaultPathSource: VaultConfig["vaultPathSource"] = rawVaultPath ? "env" : "missing";

  if (!rawVaultPath) {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as { vaultPath?: unknown };
      if (typeof parsed.vaultPath === "string" && parsed.vaultPath.trim() !== "") {
        rawVaultPath = parsed.vaultPath.trim();
        vaultPathSource = "config";
      }
    } catch {
      // Missing fallback config is normal. Surface an actionable error below.
    }
  }

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
    errors.push("Vault path is not configured. Set OBSIDIAN_VAULT_PATH, OBSIDIAN_VAULT_NAME, or OBSIDIAN_VAULT_ID.");
  }

  const cliPath = env.OBSIDIAN_CLI_PATH?.trim() || "obsidian";
  const cliTimeoutMs = clampNumber(parseInteger(env.OBSIDIAN_CLI_TIMEOUT_MS), 1_000, 60_000, 10_000);
  const defaultBudget = parseBudget(env.OBSIDIAN_RETRIEVE_BUDGET) ?? "standard";
  const budgetChars: Record<BudgetProfile, number> = {
    tiny: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_TINY_CHARS), 1_000, 12_000, 3_500),
    standard: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_STANDARD_CHARS), 2_000, 12_000, 8_000),
    expanded: clampNumber(parseInteger(env.OBSIDIAN_RETRIEVE_EXPANDED_CHARS), 4_000, 12_000, 12_000),
  };

  const config: VaultConfig = { vaultPathSource, cliPath, cliTimeoutMs, defaultBudget, budgetChars, errors };
  if (rawVaultPath) config.rawVaultPath = rawVaultPath;
  if (vaultRoot) config.vaultRoot = vaultRoot;
  if (vaultTarget) config.vaultTarget = vaultTarget;
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
