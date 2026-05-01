import { mkdtemp, readFile, rm, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerObsidianVault } from "../src/index.js";
import { FakeObsidianCliBackend, seededFakeCli } from "./fake-obsidian-cli.js";

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

export async function expectPathMissing(vaultRoot: string, relativePath: string): Promise<void> {
  if (await pathExists(vaultRoot, relativePath)) throw new Error(`Expected ${relativePath} to be missing.`);
}

export async function expectTrashTarget(vaultRoot: string, relativePath: string, expectedContent: string): Promise<void> {
  const actual = await readNote(vaultRoot, relativePath);
  if (actual !== expectedContent) throw new Error(`Expected trash target ${relativePath} to contain original note content.`);
}

export async function expectNoteUnchanged(vaultRoot: string, relativePath: string, expectedContent: string): Promise<void> {
  const actual = await readNote(vaultRoot, relativePath);
  if (actual !== expectedContent) throw new Error(`Expected ${relativePath} to remain unchanged.`);
}

export async function expectRestoredNote(vaultRoot: string, trashPath: string, toPath: string, expectedContent: string): Promise<void> {
  await expectPathMissing(vaultRoot, trashPath);
  const actual = await readNote(vaultRoot, toPath);
  if (actual !== expectedContent) throw new Error(`Expected restored note ${toPath} to contain original trash content.`);
}

export async function expectRestorePreviewUnchanged(vaultRoot: string, trashPath: string, toPath: string, expectedContent: string): Promise<void> {
  await expectNoteUnchanged(vaultRoot, trashPath, expectedContent);
  if (await pathExists(vaultRoot, toPath)) throw new Error(`Expected restore destination ${toPath} to remain missing during preview.`);
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

export function registerVaultExtensionForTest(vaultRoot: string, backend: FakeObsidianCliBackend = seededFakeCli()) {
  const pi = fakePi();
  registerObsidianVault(pi as any, { backend, env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
  return { pi, backend };
}

export async function executeTool<T = any>(pi: ReturnType<typeof fakePi>, toolName: string, params: unknown): Promise<T> {
  const tool = pi.tools.get(toolName);
  if (!tool) throw new Error(`Missing registered tool ${toolName}.`);
  const response = await tool.execute("test-call", params);
  return response.details as T;
}

export async function runStatusCommand(pi: ReturnType<typeof fakePi>): Promise<{ message: string; level: string | undefined }> {
  const command = pi.commands.get("obsidian-vault");
  if (!command) throw new Error("Missing obsidian-vault command.");
  const messages: Array<{ message: string; level: string | undefined }> = [];
  await command.handler("", { ui: { notify(message: string, level?: string) { messages.push({ message, level }); } } });
  if (messages.length !== 1) throw new Error(`Expected one status notification, received ${messages.length}.`);
  return messages[0]!;
}

export async function vaultSnapshot(vaultRoot: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(relativeDir: string): Promise<void> {
    const absoluteDir = path.join(vaultRoot, ...relativeDir.split("/").filter(Boolean));
    const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        snapshot[`${relativePath}/`] = "<dir>";
        await visit(relativePath);
      } else if (entry.isFile()) {
        snapshot[relativePath] = await readFile(absolutePath, "utf8");
      } else {
        snapshot[relativePath] = "<special>";
      }
    }
  }
  await visit("");
  return snapshot;
}

export function expectNoSensitivePathLeak(value: unknown, sensitiveValues: string[]): void {
  const text = typeof value === "string" ? value : stringifyDetails(value);
  for (const sensitive of sensitiveValues.filter(Boolean)) {
    if (text.includes(sensitive)) throw new Error(`Response leaked sensitive path ${sensitive}: ${text}`);
  }
}

export function expectNoLocalPathLeak(value: unknown, vaultRoot: string): void {
  const text = stringifyDetails(value);
  if (text.includes(vaultRoot)) throw new Error(`Response leaked vault root: ${text}`);
  if (/\/tmp\/pi-obsidian-(write|outside)-/.test(text)) throw new Error(`Response leaked temp path: ${text}`);
}

export function stringifyDetails(value: unknown): string {
  return JSON.stringify(value);
}
