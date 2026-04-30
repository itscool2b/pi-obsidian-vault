import { constants as fsConstants } from "node:fs";
import { access, appendFile, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeVaultRelativePath } from "./path-safety.js";
import type { ObsidianWriteOperation, WriteContentSummary, WriteTargetSummary } from "./write-types.js";

export interface VaultWritePreviewInput {
  operation: ObsidianWriteOperation;
  path: string;
  content: WriteContentSummary;
}

export interface VaultWriteCommitInput extends VaultWritePreviewInput {}

export class VaultWriterSafetyError extends Error {
  constructor(message: string, public readonly code = "UNSAFE_PATH") {
    super(message);
    this.name = "VaultWriterSafetyError";
  }
}

export class VaultWriterConflictError extends Error {
  constructor(message: string, public readonly code: "TARGET_EXISTS" | "TARGET_MISSING") {
    super(message);
    this.name = "VaultWriterConflictError";
  }
}

export class VaultWriterSetupError extends Error {
  constructor(message: string, public readonly code: "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE") {
    super(message);
    this.name = "VaultWriterSetupError";
  }
}

export interface VaultWriter {
  normalizePath(input: string): string;
  preview(input: VaultWritePreviewInput): Promise<WriteTargetSummary>;
  commit(input: VaultWriteCommitInput): Promise<WriteTargetSummary>;
}

export class LocalVaultWriter implements VaultWriter {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly root: string;
  private rootRealpath: Promise<string> | undefined;

  constructor(vaultRoot: string | undefined) {
    if (!vaultRoot) throw new VaultWriterSetupError("A local vault path is required for obsidian_write.", "VAULT_PATH_REQUIRED");
    this.root = vaultRoot;
  }

  normalizePath(input: string): string {
    return normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
  }

  async preview(input: VaultWritePreviewInput): Promise<WriteTargetSummary> {
    const safePath = this.normalizePath(input.path);
    const target = await this.inspectTarget(safePath, input.operation, input.content, false);
    return target;
  }

  async commit(input: VaultWriteCommitInput): Promise<WriteTargetSummary> {
    const safePath = this.normalizePath(input.path);
    return this.withTargetQueue(safePath, async () => {
      const target = await this.inspectTarget(safePath, input.operation, input.content, true);
      const absolutePath = await this.absoluteTargetPath(safePath);
      const parentPath = path.dirname(absolutePath);
      if (input.operation === "create") {
        await mkdir(parentPath, { recursive: true });
        await this.assertRealPathContained(parentPath, "Target parent directory is outside the configured vault.");
        const handle = await open(absolutePath, "wx").catch((error: unknown) => {
          if (isNodeError(error, "EEXIST")) throw new VaultWriterConflictError("Target note already exists; create will not overwrite it.", "TARGET_EXISTS");
          throw error;
        });
        try {
          await handle.writeFile(input.content.raw, "utf8");
        } finally {
          await handle.close();
        }
        return { ...target, existsAfter: true, bytesAfter: input.content.bytes };
      }

      await appendFile(absolutePath, input.content.raw, "utf8");
      const after = await stat(absolutePath);
      return { ...target, existsAfter: true, bytesAfter: after.size };
    });
  }

  private async inspectTarget(safePath: string, operation: ObsidianWriteOperation, content: WriteContentSummary, forCommit: boolean): Promise<WriteTargetSummary> {
    const absolutePath = await this.absoluteTargetPath(safePath);
    const parentPath = path.dirname(absolutePath);
    const parentExistsBefore = await exists(parentPath);
    if (parentExistsBefore) await this.assertRealPathContained(parentPath, "Target parent directory is outside the configured vault.");
    else if (operation === "append") throw new VaultWriterConflictError("Target note does not exist; append will not create it.", "TARGET_MISSING");
    else await this.assertNearestExistingAncestorContained(parentPath);

    const targetExists = await exists(absolutePath);
    if (targetExists) await this.assertRealPathContained(absolutePath, "Target note resolves outside the configured vault.");

    if (operation === "create" && targetExists) throw new VaultWriterConflictError("Target note already exists; create will not overwrite it.", "TARGET_EXISTS");
    if (operation === "append" && !targetExists) throw new VaultWriterConflictError("Target note does not exist; append will not create it.", "TARGET_MISSING");

    const bytesBefore = targetExists ? (await stat(absolutePath)).size : undefined;
    const bytesAfter = operation === "append" ? (bytesBefore ?? 0) + content.bytes : content.bytes;
    const summary: WriteTargetSummary = { path: safePath, existsBefore: targetExists };
    summary.existsAfter = forCommit ? operation === "append" || operation === "create" : targetExists;
    summary.parentExistsBefore = parentExistsBefore;
    summary.createdParentDirectories = forCommit && operation === "create" && !parentExistsBefore;
    if (bytesBefore !== undefined) summary.bytesBefore = bytesBefore;
    summary.bytesAfter = bytesAfter;
    return summary;
  }

  private async absoluteTargetPath(safePath: string): Promise<string> {
    const root = await this.vaultRootRealpath();
    const absolutePath = path.resolve(root, ...safePath.split("/"));
    assertContained(root, absolutePath, "Target path is outside the configured vault.");
    return absolutePath;
  }

  private async vaultRootRealpath(): Promise<string> {
    this.rootRealpath ??= realpath(this.root).then(async (resolved) => {
      const info = await stat(resolved).catch(() => undefined);
      if (!info?.isDirectory()) throw new VaultWriterSetupError("Configured vault path is not a directory.", "VAULT_NOT_ACCESSIBLE");
      await access(resolved, fsConstants.W_OK).catch(() => {
        throw new VaultWriterSetupError("Configured vault path is not writable.", "VAULT_NOT_WRITABLE");
      });
      return resolved;
    }).catch((error: unknown) => {
      if (error instanceof VaultWriterSetupError) throw error;
      throw new VaultWriterSetupError("Configured vault path is not accessible.", "VAULT_NOT_ACCESSIBLE");
    });
    return this.rootRealpath;
  }

  private async assertRealPathContained(inputPath: string, message: string): Promise<void> {
    const root = await this.vaultRootRealpath();
    const resolved = await realpath(inputPath).catch(() => undefined);
    if (!resolved) return;
    assertContained(root, resolved, message);
  }

  private async assertNearestExistingAncestorContained(inputPath: string): Promise<void> {
    const root = await this.vaultRootRealpath();
    let current = inputPath;
    while (current !== root && current !== path.dirname(current)) {
      if (await exists(current)) {
        const resolved = await realpath(current);
        assertContained(root, resolved, "Target parent directory is outside the configured vault.");
        return;
      }
      current = path.dirname(current);
    }
    assertContained(root, current, "Target parent directory is outside the configured vault.");
  }

  private async withTargetQueue<T>(safePath: string, run: () => Promise<T>): Promise<T> {
    const key = `${await this.vaultRootRealpath()}::${safePath}`;
    const previous = LocalVaultWriter.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const next = previous.then(() => current, () => current);
    LocalVaultWriter.queues.set(key, next);
    await previous.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (LocalVaultWriter.queues.get(key) === next) LocalVaultWriter.queues.delete(key);
    }
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new VaultWriterSafetyError(message, "UNSAFE_PATH");
}

async function exists(inputPath: string): Promise<boolean> {
  try {
    await stat(inputPath);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export function writeErrorFromUnknown(error: unknown): { code: string; message: string; category: "safety" | "conflict" | "setup" | "runtime" } {
  if (error instanceof PathSafetyError || error instanceof VaultWriterSafetyError) return { code: "UNSAFE_PATH", message: "The target path is not a safe vault-relative Markdown path.", category: "safety" };
  if (error instanceof VaultWriterConflictError) return { code: error.code, message: error.message, category: "conflict" };
  if (error instanceof VaultWriterSetupError) return { code: error.code, message: error.message, category: "setup" };
  return { code: "WRITE_FAILED", message: "The write could not be completed safely.", category: "runtime" };
}
