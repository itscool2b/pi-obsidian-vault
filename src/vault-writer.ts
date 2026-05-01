import { constants as fsConstants } from "node:fs";
import { access, appendFile, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeVaultFolderTarget, normalizeVaultRelativePath } from "./path-safety.js";
import { withTargetLock } from "./target-lock.js";
import type { ObsidianWriteOperation, WriteContentSummary, WriteTargetSummary } from "./write-types.js";

export interface VaultWritePreviewInput {
  operation: ObsidianWriteOperation;
  path: string;
  content?: WriteContentSummary | undefined;
}

export interface VaultWriteCommitInput extends VaultWritePreviewInput {}

export class VaultWriterSafetyError extends Error {
  constructor(message: string, public readonly code = "UNSAFE_PATH") {
    super(message);
    this.name = "VaultWriterSafetyError";
  }
}

export class VaultWriterConflictError extends Error {
  constructor(message: string, public readonly code: "TARGET_EXISTS" | "TARGET_MISSING" | "TARGET_FOLDER_EXISTS" | "TARGET_NOT_FOLDER" | "PARENT_NOT_FOLDER") {
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
  normalizePath(input: string, operation?: ObsidianWriteOperation | undefined): string;
  preview(input: VaultWritePreviewInput): Promise<WriteTargetSummary>;
  commit(input: VaultWriteCommitInput): Promise<WriteTargetSummary>;
}

export class LocalVaultWriter implements VaultWriter {
  private readonly root: string;
  private rootRealpath: Promise<string> | undefined;

  constructor(vaultRoot: string | undefined) {
    if (!vaultRoot) throw new VaultWriterSetupError("A local vault path is required for obsidian_write.", "VAULT_PATH_REQUIRED");
    this.root = vaultRoot;
  }

  normalizePath(input: string, operation: ObsidianWriteOperation = "create"): string {
    if (operation === "create_folder") return normalizeVaultFolderTarget(input);
    return normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
  }

  async preview(input: VaultWritePreviewInput): Promise<WriteTargetSummary> {
    const safePath = this.normalizePath(input.path, input.operation);
    if (input.operation === "create_folder") return this.inspectFolderTarget(safePath, false);
    const target = await this.inspectTarget(safePath, input.operation, requireContent(input), false);
    return target;
  }

  async commit(input: VaultWriteCommitInput): Promise<WriteTargetSummary> {
    const safePath = this.normalizePath(input.path, input.operation);
    return this.withTargetQueue(safePath, async () => {
      if (input.operation === "create_folder") return this.commitFolder(safePath);

      const content = requireContent(input);
      const target = await this.inspectTarget(safePath, input.operation, content, true);
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
          await handle.writeFile(content.raw, "utf8");
        } finally {
          await handle.close();
        }
        return { ...target, existsAfter: true, bytesAfter: content.bytes };
      }

      await appendFile(absolutePath, content.raw, "utf8");
      const after = await stat(absolutePath);
      return { ...target, existsAfter: true, bytesAfter: after.size };
    });
  }

  private async commitFolder(safePath: string): Promise<WriteTargetSummary> {
    const target = await this.inspectFolderTarget(safePath, true);
    const absolutePath = await this.absoluteTargetPath(safePath);
    const parentPath = path.dirname(absolutePath);
    await mkdir(parentPath, { recursive: true }).catch((error: unknown) => {
      if (isNodeError(error, "ENOTDIR")) throw new VaultWriterConflictError("A non-folder entry blocks the target parent folder path.", "PARENT_NOT_FOLDER");
      throw error;
    });
    await this.assertRealPathContained(parentPath, "Target parent directory is outside the configured vault.");
    await mkdir(absolutePath).catch(async (error: unknown) => {
      if (isNodeError(error, "EEXIST")) {
        const info = await stat(absolutePath).catch(() => undefined);
        if (info?.isDirectory()) throw new VaultWriterConflictError("Target folder already exists; create_folder will not reuse it as a mutation.", "TARGET_FOLDER_EXISTS");
        throw new VaultWriterConflictError("Target path already exists and is not a folder.", "TARGET_NOT_FOLDER");
      }
      if (isNodeError(error, "ENOTDIR")) throw new VaultWriterConflictError("A non-folder entry blocks the target parent folder path.", "PARENT_NOT_FOLDER");
      throw error;
    });
    await this.assertRealPathContained(absolutePath, "Target folder resolves outside the configured vault.");
    return { ...target, existsAfter: true, folderExistsAfter: true, createdParentDirectories: !target.parentExistsBefore };
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
    const summary: WriteTargetSummary = { path: safePath, targetKind: "markdown", existsBefore: targetExists };
    summary.existsAfter = forCommit ? operation === "append" || operation === "create" : targetExists;
    summary.parentExistsBefore = parentExistsBefore;
    summary.createdParentDirectories = forCommit && operation === "create" && !parentExistsBefore;
    if (bytesBefore !== undefined) summary.bytesBefore = bytesBefore;
    summary.bytesAfter = bytesAfter;
    return summary;
  }

  private async inspectFolderTarget(safePath: string, forCommit: boolean): Promise<WriteTargetSummary> {
    const absolutePath = await this.absoluteTargetPath(safePath);
    const parentPath = path.dirname(absolutePath);
    const parentExistsBefore = await this.inspectFolderParent(parentPath);

    const targetInfo = await stat(absolutePath).catch(() => undefined);
    if (targetInfo) {
      await this.assertRealPathContained(absolutePath, "Target folder resolves outside the configured vault.");
      if (targetInfo.isDirectory()) throw new VaultWriterConflictError("Target folder already exists; create_folder will not reuse it as a mutation.", "TARGET_FOLDER_EXISTS");
      throw new VaultWriterConflictError("Target path already exists and is not a folder.", "TARGET_NOT_FOLDER");
    }

    return {
      path: safePath,
      targetKind: "folder",
      existsBefore: false,
      folderExistsBefore: false,
      existsAfter: forCommit,
      folderExistsAfter: forCommit,
      parentExistsBefore,
      createdParentDirectories: forCommit && !parentExistsBefore,
    };
  }

  private async inspectFolderParent(parentPath: string): Promise<boolean> {
    const root = await this.vaultRootRealpath();
    let current = parentPath;
    while (true) {
      const info = await stat(current).catch(() => undefined);
      if (info) {
        const resolved = await realpath(current);
        assertContained(root, resolved, "Target parent directory is outside the configured vault.");
        if (!info.isDirectory()) throw new VaultWriterConflictError("A non-folder entry blocks the target parent folder path.", "PARENT_NOT_FOLDER");
        return current === parentPath;
      }
      if (current === root || current === path.dirname(current)) {
        assertContained(root, current, "Target parent directory is outside the configured vault.");
        return false;
      }
      current = path.dirname(current);
    }
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
    return withTargetLock(`${await this.vaultRootRealpath()}::${safePath}`, run);
  }
}

function requireContent(input: { content?: WriteContentSummary | undefined }): WriteContentSummary {
  if (!input.content) throw new Error("Markdown content is required for this write operation.");
  return input.content;
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
  if (error instanceof PathSafetyError || error instanceof VaultWriterSafetyError) return { code: "UNSAFE_PATH", message: "The target path is not a safe vault-relative path for the requested obsidian_write operation.", category: "safety" };
  if (error instanceof VaultWriterConflictError) return { code: error.code, message: error.message, category: "conflict" };
  if (error instanceof VaultWriterSetupError) return { code: error.code, message: error.message, category: "setup" };
  return { code: "WRITE_FAILED", message: "The write could not be completed safely.", category: "runtime" };
}
