import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

export async function withTempVault<T>(run: (vaultRoot: string) => Promise<T>): Promise<T> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-write-"));
  try {
    return await run(vaultRoot);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

export async function seedNote(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

export async function readNote(vaultRoot: string, relativePath: string): Promise<string> {
  return readFile(path.join(vaultRoot, ...relativePath.split("/")), "utf8");
}

export async function seedFile(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

export async function seedFolder(vaultRoot: string, relativePath: string): Promise<void> {
  await mkdir(path.join(vaultRoot, ...relativePath.split("/")), { recursive: true });
}

export async function folderExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  const info = await stat(path.join(vaultRoot, ...relativePath.split("/"))).catch(() => undefined);
  return info?.isDirectory() ?? false;
}

export async function pathExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  return stat(path.join(vaultRoot, ...relativePath.split("/"))).then(() => true, () => false);
}

export async function expectFolderMissing(vaultRoot: string, relativePath: string): Promise<void> {
  if (await pathExists(vaultRoot, relativePath)) throw new Error(`Expected ${relativePath} to be missing.`);
}

export async function expectNoteUnchanged(vaultRoot: string, relativePath: string, expectedContent: string): Promise<void> {
  const actual = await readNote(vaultRoot, relativePath);
  if (actual !== expectedContent) throw new Error(`Expected ${relativePath} to remain unchanged.`);
}

export function absoluteNotePath(vaultRoot: string, relativePath: string): string {
  return path.join(vaultRoot, ...relativePath.split("/"));
}

export function fakePi() {
  return {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { this.commands.set(name, command); },
  };
}

export function registerWriteTool(vaultRoot: string) {
  const pi = fakePi();
  registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
  return pi.tools.get("obsidian_write");
}

export function registerEditTool(vaultRoot: string) {
  const pi = fakePi();
  registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
  return pi.tools.get("obsidian_edit");
}

export function registerManageTool(vaultRoot: string) {
  const pi = fakePi();
  registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
  return pi.tools.get("obsidian_manage");
}

export function expectNoLocalPathLeak(value: unknown, vaultRoot: string): void {
  const text = stringifyDetails(value);
  if (text.includes(vaultRoot)) throw new Error(`Response leaked vault root: ${text}`);
  if (/\/tmp\/pi-obsidian-(write|outside)-/.test(text)) throw new Error(`Response leaked temp path: ${text}`);
}

export function stringifyDetails(value: unknown): string {
  return JSON.stringify(value);
}
