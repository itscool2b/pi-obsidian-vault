import { spawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { ObsidianCliError } from "./errors.js";
import { normalizeVaultFolder, normalizeVaultRelativePath } from "./path-safety.js";
import type {
  AliasesCommandResult,
  BacklinksCommandResult,
  FileInfoCommandResult,
  FileListCommandResult,
  FilesCommandInput,
  FolderListCommandResult,
  FoldersCommandInput,
  LinksCommandResult,
  ObsidianCliBackend,
  ObsidianCliHealth,
  OptionalPathCommandInput,
  OutlineCommandResult,
  PathCommandInput,
  PropertiesCommandResult,
  ReadCommandResult,
  RecentsCommandResult,
  SearchCommandInput,
  SearchCommandResult,
  SearchContextCommandResult,
  TagsCommandResult,
  FileCommandInput,
} from "./retrieval-types.js";

const READ_ONLY_COMMANDS = new Set([
  "version",
  "help",
  "search",
  "search:context",
  "files",
  "folders",
  "file",
  "read",
  "outline",
  "aliases",
  "tags",
  "tag",
  "properties",
  "links",
  "backlinks",
  "recents",
]);
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_RECORDS = 500;

export interface ObsidianCliAdapterOptions {
  cliPath?: string | undefined;
  vaultTarget?: string | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  runner?: CommandRunner | undefined;
}

export interface CommandRunOptions {
  cwd?: string | undefined;
  timeoutMs: number;
  maxBytes: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean | undefined;
}

export type CommandRunner = (command: string, args: string[], options: CommandRunOptions) => Promise<CommandResult>;

export interface BuiltCommand {
  command: string;
  args: string[];
  options: CommandRunOptions;
}

export class ObsidianCliAdapter implements ObsidianCliBackend {
  private readonly cliPath: string;
  private readonly vaultTarget: string | undefined;
  private readonly cwd: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CommandRunner;

  constructor(options: ObsidianCliAdapterOptions = {}) {
    this.cliPath = options.cliPath ?? "obsidian";
    this.vaultTarget = options.vaultTarget;
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.runner = options.runner ?? spawnRunner;
  }

  async checkHealth(): Promise<ObsidianCliHealth> {
    const health: ObsidianCliHealth = { available: false, cliPath: this.cliPath, errors: [], warnings: [] };
    if (this.vaultTarget) health.vaultTarget = this.vaultTarget;
    try {
      const result = await this.execute(["version"], { parseJson: false });
      health.available = true;
      health.version = firstNonEmptyLine(result.stdout);
      return health;
    } catch (error) {
      health.errors.push(error instanceof Error ? error.message : String(error));
    }
    try {
      await this.execute(["help"], { parseJson: false });
      health.available = true;
      return health;
    } catch (error) {
      health.errors.push(error instanceof Error ? error.message : String(error));
      return health;
    }
  }

  async search(input: SearchCommandInput): Promise<SearchCommandResult> {
    const limit = safeLimit(input.limit);
    const args = ["search", `query=${input.query}`, `limit=${limit}`, "format=json"];
    if (input.folder) args.push(`path=${normalizeVaultFolder(input.folder)}`);
    if (input.caseSensitive) args.push("case");
    const result = await this.execute(args, { parseJson: true });
    const json = parseJsonOutput(result.stdout);
    const rows = searchRowsFrom(json, result.stdout);
    const hits = rows.slice(0, limit).map((item) => ({ path: safeMarkdownPath(pathFrom(item)), scoreHint: numberFrom(item, ["score", "scoreHint"]) })).filter((item) => item.path !== "");
    return { hits, total: totalFrom(json, rows), limited: isLimited(json, rows, limit) };
  }

  async searchContext(input: SearchCommandInput): Promise<SearchContextCommandResult> {
    const limit = safeLimit(input.limit);
    const args = ["search:context", `query=${input.query}`, `limit=${limit}`, "format=json"];
    if (input.folder) args.push(`path=${normalizeVaultFolder(input.folder)}`);
    if (input.caseSensitive) args.push("case");
    const result = await this.execute(args, { parseJson: true });
    const json = parseJsonOutput(result.stdout);
    const rows = searchContextRowsFrom(json, result.stdout);
    const hits = rows.slice(0, limit).map((item) => ({ path: safeMarkdownPath(pathFrom(item)), line: Math.max(1, numberFrom(item, ["line", "lineNumber"]) ?? 1), text: stringFrom(item, ["text", "snippet", "context", "lineText"]) })).filter((item) => item.path !== "" && item.text !== "");
    return { hits, total: totalFrom(json, rows), limited: isLimited(json, rows, limit) };
  }

  async files(input: FilesCommandInput): Promise<FileListCommandResult> {
    const limit = safeLimit(input.limit ?? MAX_RECORDS);
    const args = ["files", "ext=md", `limit=${limit}`, "format=json"];
    if (input.folder) args.push(`folder=${normalizeVaultFolder(input.folder)}`);
    const result = await this.execute(args, { parseJson: true });
    const json = parseJsonOutput(result.stdout);
    const rows = fileRowsFrom(json, result.stdout);
    const files = rows.slice(0, limit).map((item) => {
      const path = safeMarkdownPath(pathFrom(item));
      return { path, name: maybeString(item, ["name", "title"]), modified: maybeString(item, ["modified", "mtime"]), size: numberFrom(item, ["size"]) };
    }).filter((item) => item.path !== "");
    return { files, total: totalFrom(json, rows), limited: isLimited(json, rows, limit) };
  }

  async folders(input: FoldersCommandInput): Promise<FolderListCommandResult> {
    const limit = safeLimit(input.limit ?? MAX_RECORDS);
    const args = ["folders", `limit=${limit}`, "format=json"];
    if (input.folder) args.push(`folder=${normalizeVaultFolder(input.folder)}`);
    const json = await this.executeJson(args);
    const rows = arrayFrom(json, ["folders", "results", "items"]);
    const folders = rows.slice(0, limit).map((item) => {
      const raw = pathFrom(item);
      const folderPath = raw === "" ? "" : normalizeVaultFolder(raw);
      return { path: folderPath, name: maybeString(item, ["name", "title"]), noteCount: numberFrom(item, ["noteCount", "count"]) };
    });
    return { folders, total: totalFrom(json, rows), limited: isLimited(json, rows, limit) };
  }

  async file(input: FileCommandInput): Promise<FileInfoCommandResult> {
    const args = ["file", "format=json"];
    if (input.path) args.push(`path=${normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true })}`);
    if (input.file) args.push(`file=${input.file}`);
    const result = await this.execute(args, { parseJson: true });
    const json = parseJsonOutput(result.stdout);
    const item = Object.keys(firstObject(json)).length > 0 ? firstObject(json) : tsvObjectFrom(result.stdout);
    const fileInfo: FileInfoCommandResult = { path: safeMarkdownPath(pathFrom(item)) };
    const name = maybeString(item, ["name", "title"]);
    const extension = maybeString(item, ["extension", "ext"]);
    const modified = maybeString(item, ["modified", "mtime"]);
    const created = maybeString(item, ["created", "ctime"]);
    const size = numberFrom(item, ["size"]);
    if (name) fileInfo.name = name;
    if (extension) fileInfo.extension = extension;
    if (modified) fileInfo.modified = modified;
    if (created) fileInfo.created = created;
    if (size !== undefined) fileInfo.size = size;
    return fileInfo;
  }

  async read(input: PathCommandInput): Promise<ReadCommandResult> {
    const path = normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true });
    const result = await this.execute(["read", `path=${path}`], { parseJson: false });
    return { path, content: result.stdout.slice(0, MAX_STDOUT_BYTES) };
  }

  async outline(input: PathCommandInput): Promise<OutlineCommandResult> {
    const path = normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true });
    const json = await this.executeJson(["outline", `path=${path}`, "format=json"]);
    const rows = arrayFrom(json, ["headings", "outline", "items"]);
    const headings = rows.slice(0, MAX_RECORDS).map((item) => ({ text: stringFrom(item, ["text", "heading", "title"]), level: numberFrom(item, ["level", "depth"]), line: numberFrom(item, ["line", "lineNumber"]) })).filter((item) => item.text !== "");
    return { path, headings, limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async aliases(input: OptionalPathCommandInput): Promise<AliasesCommandResult> {
    const args = ["aliases", "format=json"];
    if (input.path) args.push(`path=${normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true })}`);
    const json = await this.executeJson(args);
    const rows = arrayFrom(json, ["aliases", "results", "items"]);
    const aliases = rows.slice(0, MAX_RECORDS).map((item) => ({ alias: stringFrom(item, ["alias", "name"]), paths: pathsFrom(item, ["paths", "files", "path"]) })).filter((item) => item.alias !== "" && item.paths.length > 0);
    return { aliases, limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async tags(input: OptionalPathCommandInput & { counts?: boolean; tag?: string }): Promise<TagsCommandResult> {
    const args = [input.tag ? "tag" : "tags", "format=json"];
    if (input.path) args.push(`path=${normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true })}`);
    if (input.counts) args.push("counts");
    if (input.tag) args.push(`name=${input.tag}`);
    const json = await this.executeJson(args);
    const rows = arrayFrom(json, ["tags", "results", "items"]);
    const tags = rows.slice(0, MAX_RECORDS).map((item) => ({ tag: stringFrom(item, ["tag", "name"]), count: numberFrom(item, ["count"]), paths: pathsFrom(item, ["paths", "files", "path"]) })).filter((item) => item.tag !== "");
    return { tags, total: totalFrom(json, rows), limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async properties(input: OptionalPathCommandInput & { name?: string; counts?: boolean }): Promise<PropertiesCommandResult> {
    const args = ["properties", "format=json"];
    if (input.path) args.push(`path=${normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true })}`);
    if (input.name) args.push(`name=${input.name}`);
    if (input.counts) args.push("counts");
    const json = await this.executeJson(args);
    const rows = arrayFrom(json, ["properties", "results", "items"]);
    const properties = rows.slice(0, MAX_RECORDS).map((item) => ({ name: stringFrom(item, ["name", "property", "key"]), value: valueFrom(item, ["value"]), count: numberFrom(item, ["count"]), paths: pathsFrom(item, ["paths", "files", "path"]) })).filter((item) => item.name !== "");
    return { properties, total: totalFrom(json, rows), limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async links(input: PathCommandInput): Promise<LinksCommandResult> {
    const path = normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true });
    const json = await this.executeJson(["links", `path=${path}`, "format=json"]);
    const rows = arrayFrom(json, ["links", "results", "items"]);
    const links = rows.slice(0, MAX_RECORDS).map((item) => ({ path: optionalSafeMarkdownPath(pathFrom(item)), rawTarget: maybeString(item, ["rawTarget", "target", "href"]), title: maybeString(item, ["title", "name"]), line: numberFrom(item, ["line", "lineNumber"]) }));
    return { path, links, total: totalFrom(json, rows), limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async backlinks(input: PathCommandInput): Promise<BacklinksCommandResult> {
    const path = normalizeVaultRelativePath(input.path, { allowEmpty: false, requireMarkdown: true });
    const json = await this.executeJson(["backlinks", `path=${path}`, "format=json"]);
    const rows = arrayFrom(json, ["backlinks", "results", "items"]);
    const backlinks = rows.slice(0, MAX_RECORDS).map((item) => ({ path: safeMarkdownPath(pathFrom(item)), title: maybeString(item, ["title", "name"]), matchedTarget: maybeString(item, ["matchedTarget", "target"]), line: numberFrom(item, ["line", "lineNumber"]), context: maybeString(item, ["context", "snippet", "text"]) })).filter((item) => item.path !== "");
    return { path, backlinks, total: totalFrom(json, rows), limited: isLimited(json, rows, MAX_RECORDS) };
  }

  async recents(): Promise<RecentsCommandResult> {
    const json = await this.executeJson(["recents", "format=json"]);
    const rows = arrayFrom(json, ["recents", "results", "items"]);
    const recents = rows.slice(0, MAX_RECORDS).map((item) => ({ path: safeMarkdownPath(pathFrom(item)), title: maybeString(item, ["title", "name"]), openedAt: maybeString(item, ["openedAt", "time", "modified"]) })).filter((item) => item.path !== "");
    return { recents, total: totalFrom(json, rows), limited: isLimited(json, rows, MAX_RECORDS) };
  }

  buildCommand(args: string[]): BuiltCommand {
    const commandName = args[0];
    if (!commandName || !READ_ONLY_COMMANDS.has(commandName)) {
      throw new ObsidianCliError(`Blocked unsupported Obsidian CLI command: ${commandName ?? "<empty>"}`, "BLOCKED_CLI_COMMAND");
    }
    const commandArgs = this.vaultTarget ? [`vault=${this.vaultTarget}`, ...args] : [...args];
    const options: CommandRunOptions = { timeoutMs: this.timeoutMs, maxBytes: MAX_STDOUT_BYTES };
    if (!this.vaultTarget && this.cwd) options.cwd = this.cwd;
    return { command: this.cliPath, args: commandArgs, options };
  }

  private async executeJson(args: string[]): Promise<unknown> {
    const result = await this.execute(args, { parseJson: true });
    try {
      return JSON.parse(result.stdout.trim() || "{}");
    } catch (error) {
      throw new ObsidianCliError(`Failed to parse Obsidian CLI JSON: ${error instanceof Error ? error.message : String(error)}`, "CLI_PARSE_ERROR");
    }
  }

  private async execute(args: string[], _options: { parseJson: boolean }): Promise<CommandResult> {
    const built = this.buildCommand(args);
    const result = await this.runner(built.command, built.args, built.options);
    if (result.timedOut) throw new ObsidianCliError(`Obsidian CLI command timed out: ${args[0]}`, "CLI_TIMEOUT");
    if (result.exitCode !== 0) throw new ObsidianCliError(`Obsidian CLI command failed (${args[0]}): ${result.stderr || result.stdout}`.trim(), "CLI_EXIT");
    return result;
  }
}

export function spawnRunner(command: string, args: string[], options: CommandRunOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptionsWithoutStdio = { shell: false };
    if (options.cwd) spawnOptions.cwd = options.cwd;
    const child = spawn(command, args, spawnOptions);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > options.maxBytes) {
        stdout = stdout.slice(0, options.maxBytes);
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > options.maxBytes) stderr = stderr.slice(0, options.maxBytes);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ObsidianCliError(error.message, "CLI_SPAWN_ERROR"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0, timedOut });
    });
  });
}

function safeLimit(value: number): number {
  return Math.max(1, Math.min(MAX_RECORDS, Math.floor(value)));
}

function parseJsonOutput(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout.trim() || "{}");
  } catch {
    return undefined;
  }
}

function searchRowsFrom(json: unknown, stdout: string): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.map((item) => typeof item === "string" ? { path: item } : objectFrom(item));
  }
  const rows = arrayFrom(json, ["hits", "matches", "results", "files"]);
  return rows.length > 0 ? rows : linePathRowsFrom(stdout);
}

function searchContextRowsFrom(json: unknown, stdout: string): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.flatMap((item) => {
      const object = objectFrom(item);
      const notePath = stringFrom(object, ["file", "path"]);
      const matches = Array.isArray(object.matches) ? object.matches.map(objectFrom) : [];
      if (notePath && matches.length > 0) {
        return matches.map((match) => ({ ...match, path: notePath }));
      }
      return typeof item === "string" ? [{ path: item, text: item, line: 1 }] : [object];
    });
  }
  const rows = arrayFrom(json, ["hits", "matches", "results", "contexts"]);
  return rows.length > 0 ? rows : linePathRowsFrom(stdout).map((row) => ({ ...row, text: row.path, line: 1 }));
}

function fileRowsFrom(json: unknown, stdout: string): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.map((item) => typeof item === "string" ? { path: item } : objectFrom(item));
  }
  const rows = arrayFrom(json, ["files", "results", "items"]);
  return rows.length > 0 ? rows : linePathRowsFrom(stdout);
}

function linePathRowsFrom(stdout: string): Record<string, unknown>[] {
  return stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^No .* found\.?$/i.test(line))
    .map((line) => ({ path: line }));
}

function tsvObjectFrom(stdout: string): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const [key, ...rest] = line.split("\t");
    if (key && rest.length > 0) object[key] = rest.join("\t");
  }
  return object;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function firstObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return objectFrom(value[0]);
  return objectFrom(value);
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayFrom(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(objectFrom);
  const object = objectFrom(value);
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate.map(objectFrom);
  }
  return [];
}

function pathFrom(value: unknown): string {
  if (typeof value === "string") return value;
  const object = objectFrom(value);
  return stringFrom(object, ["path", "file", "filePath", "target"]);
}

function pathsFrom(value: unknown, keys: string[]): string[] {
  const object = objectFrom(value);
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate.map(pathFrom).map(optionalSafeMarkdownPath).filter((item): item is string => Boolean(item));
    if (typeof candidate === "string" && candidate.endsWith(".md")) return [safeMarkdownPath(candidate)];
  }
  return [];
}

function safeMarkdownPath(input: string): string {
  try {
    return normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
  } catch {
    return "";
  }
}

function optionalSafeMarkdownPath(input: string): string | undefined {
  const path = safeMarkdownPath(input);
  return path || undefined;
}

function stringFrom(value: unknown, keys: string[]): string {
  return maybeString(value, keys) ?? "";
}

function maybeString(value: unknown, keys: string[]): string | undefined {
  const object = objectFrom(value);
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "string") return candidate;
    if (typeof candidate === "number" || typeof candidate === "boolean") return String(candidate);
  }
  return undefined;
}

function valueFrom(value: unknown, keys: string[]): string | number | boolean | string[] | undefined {
  const object = objectFrom(value);
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") return candidate;
    if (Array.isArray(candidate) && candidate.every((item) => typeof item === "string")) return candidate;
  }
  return undefined;
}

function numberFrom(value: unknown, keys: string[]): number | undefined {
  const object = objectFrom(value);
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function totalFrom(value: unknown, rows: unknown[]): number | undefined {
  const number = numberFrom(value, ["total", "count"]);
  return number ?? rows.length;
}

function isLimited(value: unknown, rows: unknown[], limit: number): boolean {
  const object = objectFrom(value);
  if (typeof object.limited === "boolean") return object.limited;
  const total = totalFrom(value, rows);
  return total !== undefined && total > limit;
}
