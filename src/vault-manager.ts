import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeTrashFolderTarget, normalizeTrashSourcePath, normalizeVaultRelativePath } from "./path-safety.js";
import { withTargetLocks } from "./target-lock.js";
import type { ManageTargetSummary, TrashTargetSummary } from "./manage-types.js";

export interface VaultMoveInput {
  fromPath: string;
  toPath: string;
}

export interface VaultTrashInput {
  path: string;
  trashFolder: string;
  trashFolderDefaulted?: boolean | undefined;
}

export class VaultManagerSafetyError extends Error {
  constructor(message: string, public readonly code = "UNSAFE_PATH") {
    super(message);
    this.name = "VaultManagerSafetyError";
  }
}

export class VaultManagerSetupError extends Error {
  constructor(message: string, public readonly code: "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE") {
    super(message);
    this.name = "VaultManagerSetupError";
  }
}

export class VaultManagerMoveError extends Error {
  constructor(message: string, public readonly code: "SOURCE_NOT_FOUND" | "SOURCE_NOT_NOTE" | "TARGET_EXISTS" | "PARENT_MISSING" | "PARENT_NOT_FOLDER") {
    super(message);
    this.name = "VaultManagerMoveError";
  }
}

export class VaultManagerTrashError extends Error {
  constructor(message: string, public readonly code: "SOURCE_NOT_FOUND" | "SOURCE_NOT_MARKDOWN" | "SOURCE_IS_FOLDER" | "SOURCE_NOT_FILE" | "TRASH_FOLDER_NOT_FOLDER" | "TRASH_TARGET_EXISTS" | "TRASH_FAILED") {
    super(message);
    this.name = "VaultManagerTrashError";
  }
}

export interface VaultManager {
  normalizePath(input: string): string;
  normalizeTrashSourcePath(input: string): string;
  normalizeTrashFolderPath(input: string): string;
  preview(input: VaultMoveInput): Promise<ManageTargetSummary>;
  commit(input: VaultMoveInput): Promise<ManageTargetSummary>;
  previewTrash(input: VaultTrashInput): Promise<TrashTargetSummary>;
  commitTrash(input: VaultTrashInput): Promise<TrashTargetSummary>;
}

export class LocalVaultManager implements VaultManager {
  private readonly root: string;
  private rootRealpath: Promise<string> | undefined;

  constructor(vaultRoot: string | undefined) {
    if (!vaultRoot) throw new VaultManagerSetupError("A local vault path is required for obsidian_manage.", "VAULT_PATH_REQUIRED");
    this.root = vaultRoot;
  }

  normalizePath(input: string): string {
    return normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
  }

  normalizeTrashSourcePath(input: string): string {
    return normalizeTrashSourcePath(input);
  }

  normalizeTrashFolderPath(input: string): string {
    return normalizeTrashFolderTarget(input);
  }

  async preview(input: VaultMoveInput): Promise<ManageTargetSummary> {
    const fromPath = this.normalizePath(input.fromPath);
    const toPath = this.normalizePath(input.toPath);
    return this.inspectMove(fromPath, toPath, false);
  }

  async commit(input: VaultMoveInput): Promise<ManageTargetSummary> {
    const fromPath = this.normalizePath(input.fromPath);
    const toPath = this.normalizePath(input.toPath);
    const root = await this.vaultRootRealpath();
    return withTargetLocks([`${root}::${fromPath}`, `${root}::${toPath}`], async () => {
      const target = await this.inspectMove(fromPath, toPath, true);
      const absoluteFrom = await this.absoluteTargetPath(fromPath);
      const absoluteTo = await this.absoluteTargetPath(toPath);
      await rename(absoluteFrom, absoluteTo).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) throw new VaultManagerMoveError("Source note or destination parent is missing.", "SOURCE_NOT_FOUND");
        if (isNodeError(error, "EEXIST")) throw new VaultManagerMoveError("Destination note already exists; move_note will not overwrite it.", "TARGET_EXISTS");
        if (isNodeError(error, "ENOTDIR")) throw new VaultManagerMoveError("Destination parent exists but is not a folder.", "PARENT_NOT_FOLDER");
        if (isNodeError(error, "EISDIR")) throw new VaultManagerMoveError("Destination path already exists; move_note will not overwrite it.", "TARGET_EXISTS");
        throw error;
      });
      const after = await stat(absoluteTo);
      return { ...target, sourceExistsAfter: false, destinationExistsAfter: true, bytesAfter: after.size };
    });
  }

  async previewTrash(input: VaultTrashInput): Promise<TrashTargetSummary> {
    const safePath = this.normalizeTrashSourcePath(input.path);
    const safeTrashFolder = this.normalizeTrashFolderPath(input.trashFolder);
    return this.inspectTrash(safePath, safeTrashFolder, input.trashFolderDefaulted ?? false, false);
  }

  async commitTrash(input: VaultTrashInput): Promise<TrashTargetSummary> {
    const safePath = this.normalizeTrashSourcePath(input.path);
    const safeTrashFolder = this.normalizeTrashFolderPath(input.trashFolder);
    const trashPath = trashPathFor(safePath, safeTrashFolder);
    const root = await this.vaultRootRealpath();
    return withTargetLocks([`${root}::${safePath}`, `${root}::${trashPath}`], async () => {
      const target = await this.inspectTrash(safePath, safeTrashFolder, input.trashFolderDefaulted ?? false, true);
      const absoluteTrashFolder = await this.absoluteTargetPath(safeTrashFolder);
      if (!target.trashFolderExistsBefore) {
        await this.assertNearestExistingAncestorContained(absoluteTrashFolder);
        await mkdir(absoluteTrashFolder, { recursive: true }).catch(async (error: unknown) => {
          if (isNodeError(error, "ENOTDIR")) throw new VaultManagerTrashError("Configured trash folder path is blocked by a non-folder entry.", "TRASH_FOLDER_NOT_FOLDER");
          if (isNodeError(error, "EEXIST")) {
            const info = await stat(absoluteTrashFolder).catch(() => undefined);
            if (!info?.isDirectory()) throw new VaultManagerTrashError("Configured trash folder path exists but is not a folder.", "TRASH_FOLDER_NOT_FOLDER");
            return;
          }
          throw error;
        });
        await this.assertRealPathContained(absoluteTrashFolder, "Trash folder resolves outside the configured vault.");
      }
      const absoluteFrom = await this.absoluteTargetPath(safePath);
      const absoluteTrashPath = await this.absoluteTargetPath(trashPath);
      await rename(absoluteFrom, absoluteTrashPath).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) throw new VaultManagerTrashError("Source note or trash folder is missing.", "SOURCE_NOT_FOUND");
        if (isNodeError(error, "EEXIST")) throw new VaultManagerTrashError("Trash target already exists; trash_note will not overwrite it.", "TRASH_TARGET_EXISTS");
        if (isNodeError(error, "ENOTDIR")) throw new VaultManagerTrashError("Configured trash folder path is blocked by a non-folder entry.", "TRASH_FOLDER_NOT_FOLDER");
        if (isNodeError(error, "EISDIR")) throw new VaultManagerTrashError("Trash target already exists; trash_note will not overwrite it.", "TRASH_TARGET_EXISTS");
        throw error;
      });
      const after = await stat(absoluteTrashPath);
      return { ...target, sourceExistsAfter: false, trashFolderExistsAfter: true, trashFolderCreated: !target.trashFolderExistsBefore, trashTargetExistsAfter: true, bytesAfter: after.size };
    });
  }

  private async inspectMove(fromPath: string, toPath: string, forCommit: boolean): Promise<ManageTargetSummary> {
    const absoluteFrom = await this.absoluteTargetPath(fromPath);
    const absoluteTo = await this.absoluteTargetPath(toPath);
    const parentPath = path.dirname(absoluteTo);

    const sourceInfo = await stat(absoluteFrom).catch(() => undefined);
    if (!sourceInfo) throw new VaultManagerMoveError("Source note does not exist; move_note will not create it.", "SOURCE_NOT_FOUND");
    await this.assertRealPathContained(absoluteFrom, "Source note resolves outside the configured vault.");
    if (!sourceInfo.isFile()) throw new VaultManagerMoveError("Source path is not an existing Markdown note file.", "SOURCE_NOT_NOTE");

    const destinationEntry = await lstat(absoluteTo).catch(() => undefined);
    if (destinationEntry) throw new VaultManagerMoveError("Destination path already exists; move_note will not overwrite it.", "TARGET_EXISTS");

    const parentInfo = await stat(parentPath).catch(() => undefined);
    if (!parentInfo) throw new VaultManagerMoveError("Destination parent folder does not exist; move_note will not create it.", "PARENT_MISSING");
    await this.assertRealPathContained(parentPath, "Destination parent folder resolves outside the configured vault.");
    if (!parentInfo.isDirectory()) throw new VaultManagerMoveError("Destination parent exists but is not a folder.", "PARENT_NOT_FOLDER");

    const renamedWithinFolder = path.posix.dirname(fromPath) === path.posix.dirname(toPath);
    return {
      fromPath,
      toPath,
      targetKind: "markdown",
      sourceExistsBefore: true,
      sourceExistsAfter: !forCommit,
      destinationExistsBefore: false,
      destinationExistsAfter: forCommit,
      parentExistsBefore: true,
      parentIsFolderBefore: true,
      renamedWithinFolder,
      movedToDifferentFolder: !renamedWithinFolder,
      bytesBefore: sourceInfo.size,
      bytesAfter: forCommit ? sourceInfo.size : undefined,
    };
  }

  private async inspectTrash(safePath: string, trashFolder: string, trashFolderDefaulted: boolean, forCommit: boolean): Promise<TrashTargetSummary> {
    const trashPath = trashPathFor(safePath, trashFolder);
    if (trashPath === safePath) throw new VaultManagerTrashError("Computed trash target is the same as the source note; trash_note will not treat this as success.", "TRASH_TARGET_EXISTS");

    const absoluteSource = await this.absoluteTargetPath(safePath);
    const absoluteTrashFolder = await this.absoluteTargetPath(trashFolder);
    const absoluteTrashPath = await this.absoluteTargetPath(trashPath);

    const sourceInfo = await stat(absoluteSource).catch(() => undefined);
    if (!sourceInfo) throw new VaultManagerTrashError("Source note does not exist; trash_note will not create it.", "SOURCE_NOT_FOUND");
    await this.assertRealPathContained(absoluteSource, "Source note resolves outside the configured vault.");
    if (sourceInfo.isDirectory()) throw new VaultManagerTrashError("Source path is a folder; trash_note will not move folders.", "SOURCE_IS_FOLDER");
    if (!sourceInfo.isFile()) throw new VaultManagerTrashError("Source path is not a regular Markdown note file.", "SOURCE_NOT_FILE");

    const trashFolderInfo = await stat(absoluteTrashFolder).catch(() => undefined);
    if (trashFolderInfo) {
      await this.assertRealPathContained(absoluteTrashFolder, "Trash folder resolves outside the configured vault.");
      if (!trashFolderInfo.isDirectory()) throw new VaultManagerTrashError("Configured trash folder path exists but is not a folder.", "TRASH_FOLDER_NOT_FOLDER");
    } else {
      await this.assertNearestExistingAncestorContained(absoluteTrashFolder);
    }

    const trashEntry = await lstat(absoluteTrashPath).catch(() => undefined);
    if (trashEntry) throw new VaultManagerTrashError("Trash target already exists; trash_note will not overwrite or auto-rename it.", "TRASH_TARGET_EXISTS");

    return {
      path: safePath,
      trashFolder,
      trashPath,
      targetKind: "markdown",
      trashFolderDefaulted,
      sourceExistsBefore: true,
      sourceExistsAfter: !forCommit,
      trashFolderExistsBefore: Boolean(trashFolderInfo),
      trashFolderExistsAfter: forCommit ? true : Boolean(trashFolderInfo),
      trashFolderWouldBeCreated: !trashFolderInfo,
      trashFolderCreated: forCommit ? !trashFolderInfo : false,
      trashTargetExistsBefore: false,
      trashTargetExistsAfter: forCommit,
      wouldOverwrite: false,
      wouldPermanentlyDelete: false,
      wouldRewriteLinks: false,
      bytesBefore: sourceInfo.size,
      bytesAfter: forCommit ? sourceInfo.size : undefined,
    };
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
      if (!info?.isDirectory()) throw new VaultManagerSetupError("Configured vault path is not a directory.", "VAULT_NOT_ACCESSIBLE");
      await access(resolved, fsConstants.R_OK | fsConstants.W_OK).catch(() => {
        throw new VaultManagerSetupError("Configured vault path is not readable and writable for obsidian_manage.", "VAULT_NOT_WRITABLE");
      });
      return resolved;
    }).catch((error: unknown) => {
      if (error instanceof VaultManagerSetupError) throw error;
      throw new VaultManagerSetupError("Configured vault path is not accessible.", "VAULT_NOT_ACCESSIBLE");
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
      const info = await stat(current).catch(() => undefined);
      if (info) {
        const resolved = await realpath(current);
        assertContained(root, resolved, "Trash folder parent resolves outside the configured vault.");
        if (!info.isDirectory()) throw new VaultManagerTrashError("Configured trash folder path is blocked by a non-folder entry.", "TRASH_FOLDER_NOT_FOLDER");
        return;
      }
      current = path.dirname(current);
    }
    assertContained(root, current, "Trash folder parent resolves outside the configured vault.");
  }
}

function trashPathFor(safePath: string, trashFolder: string): string {
  return path.posix.join(trashFolder, path.posix.basename(safePath));
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new VaultManagerSafetyError(message, "UNSAFE_PATH");
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export function manageErrorFromUnknown(error: unknown): { code: string; message: string; category: "validation" | "safety" | "conflict" | "not_found" | "setup" | "runtime" } {
  if (error instanceof PathSafetyError || error instanceof VaultManagerSafetyError) return { code: error.code, message: "The requested path is not a safe vault-relative path for obsidian_manage.", category: "safety" };
  if (error instanceof VaultManagerMoveError) {
    const category = error.code === "SOURCE_NOT_FOUND" || error.code === "PARENT_MISSING" ? "not_found" : "conflict";
    return { code: error.code, message: error.message, category };
  }
  if (error instanceof VaultManagerTrashError) {
    if (error.code === "SOURCE_NOT_MARKDOWN") return { code: error.code, message: error.message, category: "validation" };
    if (error.code === "SOURCE_NOT_FOUND") return { code: error.code, message: error.message, category: "not_found" };
    if (error.code === "TRASH_TARGET_EXISTS" || error.code === "TRASH_FOLDER_NOT_FOLDER") return { code: error.code, message: error.message, category: "conflict" };
    if (error.code === "SOURCE_IS_FOLDER" || error.code === "SOURCE_NOT_FILE") return { code: error.code, message: error.message, category: "safety" };
    return { code: "TRASH_FAILED", message: error.message, category: "runtime" };
  }
  if (error instanceof VaultManagerSetupError) return { code: error.code, message: error.message, category: "setup" };
  return { code: "MOVE_FAILED", message: "The note management operation could not be completed safely.", category: "runtime" };
}
