import { readFile } from "node:fs/promises";
import type { CommandResult, CommandRunner } from "./obsidian-cli.js";
import { spawnRunner } from "./obsidian-cli.js";

export type ObsidianAppReadyStatus = "ready" | "opened" | "skipped" | "disabled" | "setup_required" | "headless" | "unsupported" | "launch_failed" | "timeout";

export interface ObsidianAppConfig {
  vaultRoot?: string | undefined;
  vaultTarget?: string | undefined;
  vaultName?: string | undefined;
  vaultOpenUri?: string | undefined;
  autoOpenObsidian: boolean;
  openTimeoutMs: number;
  launchCommandTimeoutMs: number;
  obsidianAppPath?: string | undefined;
}

export interface ObsidianAppEnsureOpenInput {
  config: ObsidianAppConfig;
  toolName?: string | undefined;
  requiresVault?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
  platform?: NodeJS.Platform | undefined;
}

export interface ObsidianAppReadyResult {
  ok: boolean;
  status: ObsidianAppReadyStatus;
  alreadyOpen: boolean;
  launched: boolean;
  message: string;
  warnings: string[];
  errors: string[];
  retryable: boolean;
}

export interface ObsidianAppController {
  ensureOpen(input: ObsidianAppEnsureOpenInput): Promise<ObsidianAppReadyResult>;
}

export interface DesktopObsidianAppControllerOptions {
  runner?: CommandRunner | undefined;
  delay?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  env?: Record<string, string | undefined> | undefined;
  platform?: NodeJS.Platform | undefined;
  procVersionReader?: (() => Promise<string>) | undefined;
  pollIntervalMs?: number | undefined;
}

interface DetectionResult {
  running: boolean;
  warnings: string[];
}

interface LaunchAttempt {
  command: string;
  args: string[];
}

const DEFAULT_OPEN_TIMEOUT_MS = 30_000;
const DEFAULT_LAUNCH_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DETECTION_STDOUT_LIMIT = 64 * 1024;
const LAUNCH_STDOUT_LIMIT = 16 * 1024;
const WINDOWS_OBSIDIAN_PROCESS = "Obsidian.exe";

export class DesktopObsidianAppController implements ObsidianAppController {
  private readonly runner: CommandRunner;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly defaultEnv: Record<string, string | undefined> | undefined;
  private readonly defaultPlatform: NodeJS.Platform | undefined;
  private readonly procVersionReader: () => Promise<string>;
  private readonly pollIntervalMs: number;
  private readonly launchPromises = new Map<string, Promise<ObsidianAppReadyResult>>();

  constructor(options: DesktopObsidianAppControllerOptions = {}) {
    this.runner = options.runner ?? spawnRunner;
    this.delayFn = options.delay ?? delay;
    this.nowFn = options.now ?? (() => Date.now());
    this.defaultEnv = options.env;
    this.defaultPlatform = options.platform;
    this.procVersionReader = options.procVersionReader ?? defaultProcVersionReader;
    this.pollIntervalMs = Math.max(25, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  async ensureOpen(input: ObsidianAppEnsureOpenInput): Promise<ObsidianAppReadyResult> {
    const config = normalizeAppConfig(input.config);
    const platform = input.platform ?? this.defaultPlatform ?? process.platform;
    const env = input.env ?? this.defaultEnv ?? process.env;
    const detection = await this.detectRunning(platform, env, config.launchCommandTimeoutMs);
    if (detection.running) {
      return appResult({ status: "ready", ok: true, alreadyOpen: true, launched: false, message: "Obsidian is already open.", warnings: detection.warnings });
    }

    const requiresVault = input.requiresVault !== false;
    if (requiresVault && !hasLaunchTarget(config)) {
      return appResult({
        status: "setup_required",
        ok: false,
        alreadyOpen: false,
        launched: false,
        retryable: true,
        message: "Obsidian is not open and no configured vault target is available to auto-open.",
        warnings: detection.warnings,
        errors: ["Configure an Obsidian vault path before retrying."],
      });
    }

    if (!config.autoOpenObsidian) {
      return appResult({
        status: "disabled",
        ok: false,
        alreadyOpen: false,
        launched: false,
        retryable: true,
        message: "Obsidian is not open and auto-open is disabled for this session or environment.",
        warnings: detection.warnings,
        errors: ["Enable auto-open or open Obsidian manually before retrying."],
      });
    }

    const environment = await desktopEnvironment(platform, env, this.procVersionReader);
    if (!environment.supported) {
      return appResult({
        status: environment.status,
        ok: false,
        alreadyOpen: false,
        launched: false,
        retryable: environment.status !== "unsupported",
        message: environment.message,
        warnings: [...detection.warnings, ...environment.warnings],
        errors: [environment.error],
      });
    }

    const key = launchKey(config, platform, environment.wsl);
    let launchPromise = this.launchPromises.get(key);
    if (!launchPromise) {
      launchPromise = this.launchAndWait({ config, platform, env, wsl: environment.wsl, inheritedWarnings: detection.warnings });
      this.launchPromises.set(key, launchPromise);
      void launchPromise.finally(() => this.launchPromises.delete(key)).catch(() => undefined);
    }
    return launchPromise;
  }

  private async launchAndWait(input: { config: RequiredAppConfig; platform: NodeJS.Platform; env: Record<string, string | undefined>; wsl: boolean; inheritedWarnings: string[] }): Promise<ObsidianAppReadyResult> {
    const uri = buildObsidianLaunchUri(input.config, { wsl: input.wsl });
    const attempts = launchCommands(input.platform, input.wsl, uri, input.config.obsidianAppPath);
    let attempted = false;
    let launchSucceeded = false;
    for (const attempt of attempts) {
      attempted = true;
      try {
        const result = await runRawCommand(this.runner, attempt.command, attempt.args, input.config.launchCommandTimeoutMs, LAUNCH_STDOUT_LIMIT);
        if (!result.timedOut && result.exitCode === 0) {
          launchSucceeded = true;
          break;
        }
      } catch {
        // Try the next safe platform launcher without exposing local command details.
      }
    }

    if (!attempted) {
      return appResult({
        status: "unsupported",
        ok: false,
        alreadyOpen: false,
        launched: false,
        retryable: false,
        message: "No supported Obsidian launch method is available for this platform.",
        warnings: input.inheritedWarnings,
        errors: ["Obsidian could not be auto-opened on this platform."],
      });
    }

    if (!launchSucceeded) {
      return appResult({
        status: "launch_failed",
        ok: false,
        alreadyOpen: false,
        launched: false,
        retryable: true,
        message: "Obsidian could not be auto-opened with the available safe platform launchers.",
        warnings: input.inheritedWarnings,
        errors: ["Open Obsidian manually or configure an Obsidian app path before retrying."],
      });
    }

    const deadline = this.nowFn() + input.config.openTimeoutMs;
    do {
      const detection = await this.detectRunning(input.platform, input.env, input.config.launchCommandTimeoutMs);
      if (detection.running) {
        return appResult({
          status: "opened",
          ok: true,
          alreadyOpen: false,
          launched: true,
          message: "Obsidian was auto-opened successfully.",
          warnings: [...input.inheritedWarnings, ...detection.warnings],
        });
      }
      if (this.nowFn() >= deadline) break;
      await this.delayFn(Math.min(this.pollIntervalMs, Math.max(1, deadline - this.nowFn())));
    } while (this.nowFn() <= deadline);

    return appResult({
      status: "timeout",
      ok: false,
      alreadyOpen: false,
      launched: true,
      retryable: true,
      message: "Obsidian was launched but did not become detectable before the startup timeout.",
      warnings: input.inheritedWarnings,
      errors: ["Wait for Obsidian to finish starting, then retry."],
    });
  }

  private async detectRunning(platform: NodeJS.Platform, env: Record<string, string | undefined>, timeoutMs: number): Promise<DetectionResult> {
    if (platform === "darwin") return this.detectMac(timeoutMs);
    if (platform === "win32") return this.detectWindows(timeoutMs);
    if (platform === "linux") {
      const isWsl = await isWslEnvironment(env, this.procVersionReader);
      if (isWsl) return this.detectWsl(timeoutMs);
      return this.detectLinux(timeoutMs);
    }
    return { running: false, warnings: [] };
  }

  private async detectMac(timeoutMs: number): Promise<DetectionResult> {
    if (await commandExitsZero(this.runner, "pgrep", ["-x", "Obsidian"], timeoutMs)) return { running: true, warnings: [] };
    if (await commandExitsZero(this.runner, "pgrep", ["-x", "obsidian"], timeoutMs)) return { running: true, warnings: [] };
    const script = await runCommand(this.runner, "osascript", ["-e", "application \"Obsidian\" is running"], timeoutMs);
    return { running: script.ok && parseBooleanRunning(script.stdout), warnings: [] };
  }

  private async detectLinux(timeoutMs: number): Promise<DetectionResult> {
    if (await commandExitsZero(this.runner, "pgrep", ["-x", "obsidian"], timeoutMs)) return { running: true, warnings: [] };
    if (await commandExitsZero(this.runner, "pgrep", ["-x", "Obsidian"], timeoutMs)) return { running: true, warnings: [] };
    const ps = await runCommand(this.runner, "ps", ["-eo", "pid=,comm=,args="], timeoutMs);
    return { running: ps.ok && parseLinuxProcessList(ps.stdout), warnings: [] };
  }

  private async detectWindows(timeoutMs: number): Promise<DetectionResult> {
    const tasklist = await runCommand(this.runner, "tasklist", ["/FI", `IMAGENAME eq ${WINDOWS_OBSIDIAN_PROCESS}`, "/NH"], timeoutMs);
    if (tasklist.ok && parseWindowsTaskList(tasklist.stdout)) return { running: true, warnings: [] };
    const powershell = await runCommand(this.runner, "powershell.exe", ["-NoProfile", "-Command", "if (Get-Process -Name Obsidian -ErrorAction SilentlyContinue) { 'true' } else { 'false' }"], timeoutMs);
    return { running: powershell.ok && parseBooleanRunning(powershell.stdout), warnings: [] };
  }

  private async detectWsl(timeoutMs: number): Promise<DetectionResult> {
    const powershell = await runCommand(this.runner, "powershell.exe", ["-NoProfile", "-Command", "if (Get-Process -Name Obsidian -ErrorAction SilentlyContinue) { 'true' } else { 'false' }"], timeoutMs);
    if (powershell.ok) return { running: parseBooleanRunning(powershell.stdout), warnings: [] };
    return this.detectLinux(timeoutMs);
  }
}

interface RequiredAppConfig extends ObsidianAppConfig {
  autoOpenObsidian: boolean;
  openTimeoutMs: number;
  launchCommandTimeoutMs: number;
}

export function normalizeAppConfig(config: ObsidianAppConfig): RequiredAppConfig {
  return {
    ...config,
    autoOpenObsidian: config.autoOpenObsidian !== false,
    openTimeoutMs: positiveMs(config.openTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS),
    launchCommandTimeoutMs: positiveMs(config.launchCommandTimeoutMs, DEFAULT_LAUNCH_COMMAND_TIMEOUT_MS),
  };
}

export function buildObsidianLaunchUri(config: ObsidianAppConfig, options: { wsl?: boolean | undefined } = {}): string {
  if (isSafeObsidianOpenUri(config.vaultOpenUri)) return config.vaultOpenUri.trim();
  const vaultName = config.vaultName?.trim() || config.vaultTarget?.trim();
  const vaultRoot = options.wsl ? wslWindowsPath(config.vaultRoot) ?? config.vaultRoot : config.vaultRoot;
  if (vaultRoot) return `obsidian://open?path=${encodeURIComponent(vaultRoot)}`;
  if (vaultName) return `obsidian://open?vault=${encodeURIComponent(vaultName)}`;
  return "obsidian://";
}

export function parseLinuxProcessList(stdout: string): boolean {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/, 3);
    const comm = parts[1] ?? "";
    const args = trimmed.slice((parts[0]?.length ?? 0) + comm.length + 2).trim();
    if (isObsidianProcessName(comm) || hasObsidianExecutableInArgs(args)) return true;
  }
  return false;
}

export function parseWindowsTaskList(stdout: string): boolean {
  const lower = stdout.toLowerCase();
  return lower.includes("obsidian.exe") && !lower.includes("no tasks are running") && !lower.includes("no task");
}

export function parseBooleanRunning(stdout: string): boolean {
  return stdout.trim().toLowerCase().startsWith("true");
}

export function isSafeObsidianOpenUri(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return /^obsidian:\/\/open(?:\?|$)/i.test(trimmed) && !/[\r\n]/.test(trimmed);
}

export async function isWslEnvironment(env: Record<string, string | undefined>, procVersionReader: () => Promise<string> = defaultProcVersionReader): Promise<boolean> {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return (await procVersionReader()).toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function hasLaunchTarget(config: ObsidianAppConfig): boolean {
  return Boolean(config.vaultRoot || config.vaultTarget || config.vaultName || isSafeObsidianOpenUri(config.vaultOpenUri));
}

function wslWindowsPath(value: string | undefined): string | undefined {
  const match = /^\/mnt\/([a-z])\/(.*)$/i.exec(value ?? "");
  if (!match) return undefined;
  const drive = match[1]?.toUpperCase();
  const rest = (match[2] ?? "").split("/").filter(Boolean).join("\\");
  return drive ? `${drive}:\\${rest}` : undefined;
}

function launchKey(config: ObsidianAppConfig, platform: NodeJS.Platform, wsl: boolean): string {
  return [platform, wsl ? "wsl" : "native", config.vaultRoot ?? "", config.vaultTarget ?? "", config.vaultName ?? "", config.vaultOpenUri ?? "", config.obsidianAppPath ?? ""].join("\0");
}

function launchCommands(platform: NodeJS.Platform, wsl: boolean, uri: string, obsidianAppPath: string | undefined): LaunchAttempt[] {
  if (obsidianAppPath?.trim()) {
    const appPath = obsidianAppPath.trim();
    if (platform === "darwin" && appPath.endsWith(".app")) return [{ command: "open", args: ["-a", appPath, uri] }];
    return [{ command: appPath, args: [uri] }];
  }
  if (platform === "darwin") return [{ command: "open", args: [uri] }, { command: "open", args: ["-a", "Obsidian", uri] }];
  if (platform === "win32") return [{ command: "explorer.exe", args: [uri] }];
  if (platform === "linux" && wsl) return [{ command: "wslview", args: [uri] }, { command: "explorer.exe", args: [uri] }];
  if (platform === "linux") return [{ command: "xdg-open", args: [uri] }, { command: "gio", args: ["open", uri] }, { command: "flatpak", args: ["run", "md.obsidian.Obsidian", uri] }, { command: "snap", args: ["run", "obsidian", uri] }];
  return [];
}

async function desktopEnvironment(platform: NodeJS.Platform, env: Record<string, string | undefined>, procVersionReader: () => Promise<string>): Promise<{ supported: true; wsl: boolean; warnings: string[] } | { supported: false; wsl: boolean; status: "headless" | "unsupported"; message: string; error: string; warnings: string[] }> {
  const wsl = platform === "linux" ? await isWslEnvironment(env, procVersionReader) : false;
  if (env.CI && env.CI !== "false") {
    return { supported: false, wsl, status: "headless", message: "This environment looks like CI/headless mode, so Obsidian was not auto-opened.", error: "Open Obsidian manually in a desktop session before retrying.", warnings: [] };
  }
  if (platform === "linux" && !wsl && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { supported: false, wsl, status: "headless", message: "This Linux session does not expose DISPLAY or WAYLAND_DISPLAY, so Obsidian was not auto-opened.", error: "Run Pi from a desktop session or open Obsidian manually before retrying.", warnings: [] };
  }
  if (platform === "darwin" || platform === "win32" || platform === "linux") return { supported: true, wsl, warnings: [] };
  return { supported: false, wsl, status: "unsupported", message: "Auto-opening Obsidian is not supported on this operating system.", error: "Open Obsidian manually before retrying.", warnings: [] };
}

async function commandExitsZero(runner: CommandRunner, command: string, args: string[], timeoutMs: number): Promise<boolean> {
  const result = await runCommand(runner, command, args, timeoutMs);
  return result.ok;
}

async function runCommand(runner: CommandRunner, command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  try {
    const result = await runRawCommand(runner, command, args, timeoutMs, DETECTION_STDOUT_LIMIT);
    return { ok: !result.timedOut && result.exitCode === 0, stdout: result.stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function runRawCommand(runner: CommandRunner, command: string, args: string[], timeoutMs: number, maxBytes: number): Promise<CommandResult> {
  return promiseWithTimeout(runner(command, args, { timeoutMs, maxBytes }), timeoutMs + 100, () => ({ stdout: "", stderr: "", exitCode: 1, timedOut: true }));
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, timeoutMs);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
  });
}

function isObsidianProcessName(value: string): boolean {
  return /^(obsidian|Obsidian|Obsidian\.exe)$/i.test(value.trim());
}

function hasObsidianExecutableInArgs(args: string): boolean {
  const normalized = args.replace(/\\/g, "/");
  return /(?:^|\s|\/)obsidian(?:\.exe)?(?:\s|$)/i.test(normalized) && !/obsidian-cli/i.test(normalized) && !/pi-obsidian/i.test(normalized);
}

function positiveMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback;
}

function appResult(input: Partial<ObsidianAppReadyResult> & Pick<ObsidianAppReadyResult, "status" | "ok" | "alreadyOpen" | "launched" | "message">): ObsidianAppReadyResult {
  return {
    ...input,
    retryable: input.retryable ?? !input.ok,
    warnings: uniqueSorted(input.warnings ?? []),
    errors: uniqueSorted(input.errors ?? []),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function defaultProcVersionReader(): Promise<string> {
  return readFile("/proc/version", "utf8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
