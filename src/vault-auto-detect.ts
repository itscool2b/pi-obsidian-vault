import { realpath, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type AutoDetectedVaultSource = "obsidian_desktop";
export type AutoDetectedVaultConfidence = "high" | "unavailable";

export interface DetectObsidianVaultOptions {
  env?: Record<string, string | undefined> | undefined;
  homeDir?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  configPath?: string | undefined;
}

export interface AutoDetectedVault {
  source: AutoDetectedVaultSource;
  confidence: AutoDetectedVaultConfidence;
  vaultRoot?: string | undefined;
  warnings: string[];
}

interface ObsidianDesktopConfig {
  vaults?: Record<string, unknown> | undefined;
}

interface CandidateVault {
  path: string;
  realPath: string;
  open: boolean;
  ts: number;
}

export async function detectObsidianVault(options: DetectObsidianVaultOptions = {}): Promise<AutoDetectedVault> {
  const explicitConfigPath = options.configPath ?? options.env?.OBSIDIAN_DESKTOP_CONFIG_PATH?.trim();
  const configPath = explicitConfigPath || defaultObsidianConfigPath(options);
  if (!configPath) return unavailable();

  let parsed: ObsidianDesktopConfig;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as ObsidianDesktopConfig;
  } catch {
    return unavailable();
  }

  const vaults = parsed.vaults;
  if (!vaults || typeof vaults !== "object") return unavailable();

  const candidates: CandidateVault[] = [];
  for (const entry of Object.values(vaults)) {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : undefined;
    if (!record) continue;
    const rawPath = typeof record.path === "string" ? record.path.trim() : "";
    if (!rawPath) continue;
    const candidate = await candidateFromPath(rawPath, record);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) return unavailable();

  const open = candidates.filter((candidate) => candidate.open);
  const pool = open.length > 0 ? open : candidates;
  const selected = newest(pool);
  const warnings: string[] = [];
  if (candidates.length > 1) {
    warnings.push(open.length > 1
      ? "Multiple open Obsidian vaults were found; auto-selected the most recently opened vault."
      : open.length === 1
        ? "Multiple Obsidian vaults were found; auto-selected the open vault."
        : "Multiple Obsidian vaults were found; auto-selected the most recent vault.");
  }

  return { source: "obsidian_desktop", confidence: "high", vaultRoot: selected.realPath, warnings };
}

function defaultObsidianConfigPath(options: DetectObsidianVaultOptions): string | undefined {
  const home = options.homeDir ?? options.env?.HOME ?? homedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  if (platform === "win32") {
    const appData = options.env?.APPDATA;
    return appData ? path.join(appData, "obsidian", "obsidian.json") : path.join(home, "AppData", "Roaming", "obsidian", "obsidian.json");
  }
  return path.join(home, ".config", "obsidian", "obsidian.json");
}

async function candidateFromPath(rawPath: string, record: Record<string, unknown>): Promise<CandidateVault | undefined> {
  try {
    const realPath = await realpath(rawPath);
    const info = await stat(realPath);
    if (!info.isDirectory()) return undefined;
    return {
      path: rawPath,
      realPath,
      open: record.open === true,
      ts: typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0,
    };
  } catch {
    return undefined;
  }
}

function newest(candidates: CandidateVault[]): CandidateVault {
  return [...candidates].sort((a, b) => b.ts - a.ts || a.realPath.localeCompare(b.realPath))[0]!;
}

function unavailable(): AutoDetectedVault {
  return { source: "obsidian_desktop", confidence: "unavailable", warnings: [] };
}
