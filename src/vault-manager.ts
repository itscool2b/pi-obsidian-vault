import { constants as fsConstants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeCopyDestinationPath, normalizeCopySourcePath, normalizeRestoreDestinationPath, normalizeRestoreSourcePath, normalizeTrashFolderTarget, normalizeTrashSourcePath, normalizeVaultRelativePath } from "./path-safety.js";
import { withTargetLocks } from "./target-lock.js";
import type { CopyTargetSummary, ManageTargetSummary, RestoreTargetSummary, TrashTargetSummary } from "./manage-types.js";

export interface VaultMoveInput {
  fromPath: string;
  toPath: string;
}

export interface VaultTrashInput {
  path: string;
  trashFolder: string;
  trashFolderDefaulted?: boolean | undefined;
}

export interface VaultRestoreInput {
  trashPath: string;
  toPath: string;
  trashFolder: string;
  trashFolderDefaulted?: boolean | undefined;
}

export interface VaultCopyInput {
  fromPath: string;
  toPath: string;
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

export class VaultManagerRestoreError extends Error {
  constructor(message: string, public readonly code: "SAME_PATH" | "TRASH_SOURCE_NOT_FOUND" | "TRASH_SOURCE_NOT_MARKDOWN" | "TRASH_SOURCE_IS_FOLDER" | "TRASH_SOURCE_NOT_FILE" | "TARGET_NOT_MARKDOWN" | "TRASH_PATH_OUTSIDE_TRASH" | "TARGET_EXISTS" | "PARENT_MISSING" | "PARENT_NOT_FOLDER" | "TRASH_FOLDER_NOT_FOLDER" | "RESTORE_FAILED") {
    super(message);
    this.name = "VaultManagerRestoreError";
  }
}

export class VaultManagerCopyError extends Error {
  constructor(message: string, public readonly code: "SAME_PATH" | "SOURCE_NOT_FOUND" | "SOURCE_NOT_MARKDOWN" | "SOURCE_IS_FOLDER" | "SOURCE_NOT_FILE" | "TARGET_NOT_MARKDOWN" | "TARGET_EXISTS" | "PARENT_MISSING" | "PARENT_NOT_FOLDER" | "COPY_FAILED") {
    super(message);
    this.name = "VaultManagerCopyError";
  }
}

export interface VaultManager {
  normalizePath(input: string): string;
  normalizeTrashSourcePath(input: string): string;
  normalizeRestoreTrashPath(input: string): string;
  normalizeRestoreDestinationPath(input: string): string;
  normalizeCopySourcePath(input: string): string;
  normalizeCopyDestinationPath(input: string): string;
  normalizeTrashFolderPath(input: string): string;
  preview(input: VaultMoveInput): Promise<ManageTargetSummary>;
  commit(input: VaultMoveInput): Promise<ManageTargetSummary>;
  previewTrash(input: VaultTrashInput): Promise<TrashTargetSummary>;
  commitTrash(input: VaultTrashInput): Promise<TrashTargetSummary>;
  previewRestore(input: VaultRestoreInput): Promise<RestoreTargetSummary>;
  commitRestore(input: VaultRestoreInput): Promise<RestoreTargetSummary>;
  previewCopy(input: VaultCopyInput): Promise<CopyTargetSummary>;
  commitCopy(input: VaultCopyInput): Promise<CopyTargetSummary>;
  readMarkdownNote(path: string): Promise<string>;
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

  normalizeRestoreTrashPath(input: string): string {
    return normalizeRestoreSourcePath(input);
  }

  normalizeRestoreDestinationPath(input: string): string {
    return normalizeRestoreDestinationPath(input);
  }

  normalizeCopySourcePath(input: string): string {
    return normalizeCopySourcePath(input);
  }

  normalizeCopyDestinationPath(input: string): string {
    return normalizeCopyDestinationPath(input);
  }

  normalizeTrashFolderPath(input: string): string {
    return normalizeTrashFolderTarget(input);
  }

  async readMarkdownNote(inputPath: string): Promise<string> {
    const safePath = this.normalizePath(inputPath);
    const absolutePath = await this.absoluteTargetPath(safePath);
    const info = await stat(absolutePath).catch(() => undefined);
    if (!info?.isFile()) throw new VaultManagerMoveError("Source path is not an existing Markdown note file.", info ? "SOURCE_NOT_NOTE" : "SOURCE_NOT_FOUND");
    await this.assertRealPathContained(absolutePath, "Source note resolves outside the configured vault.");
    return readFile(absolutePath, "utf8");
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

  async previewRestore(input: VaultRestoreInput): Promise<RestoreTargetSummary> {
    const safeTrashPath = this.normalizeRestoreTrashPath(input.trashPath);
    const safeToPath = this.normalizeRestoreDestinationPath(input.toPath);
    const safeTrashFolder = this.normalizeTrashFolderPath(input.trashFolder);
    return this.inspectRestore(safeTrashPath, safeToPath, safeTrashFolder, input.trashFolderDefaulted ?? false, false);
  }

  async commitRestore(input: VaultRestoreInput): Promise<RestoreTargetSummary> {
    const safeTrashPath = this.normalizeRestoreTrashPath(input.trashPath);
    const safeToPath = this.normalizeRestoreDestinationPath(input.toPath);
    const safeTrashFolder = this.normalizeTrashFolderPath(input.trashFolder);
    const root = await this.vaultRootRealpath();
    return withTargetLocks([`${root}::${safeTrashPath}`, `${root}::${safeToPath}`], async () => {
      const target = await this.inspectRestore(safeTrashPath, safeToPath, safeTrashFolder, input.trashFolderDefaulted ?? false, true);
      const absoluteTrashPath = await this.absoluteTargetPath(safeTrashPath);
      const absoluteTo = await this.absoluteTargetPath(safeToPath);
      await rename(absoluteTrashPath, absoluteTo).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) throw new VaultManagerRestoreError("Trash source note or destination parent is missing.", "TRASH_SOURCE_NOT_FOUND");
        if (isNodeError(error, "EEXIST")) throw new VaultManagerRestoreError("Destination note already exists; restore_note will not overwrite it.", "TARGET_EXISTS");
        if (isNodeError(error, "ENOTDIR")) throw new VaultManagerRestoreError("Destination parent exists but is not a folder, or trashFolder is blocked by a non-folder entry.", "PARENT_NOT_FOLDER");
        if (isNodeError(error, "EISDIR")) throw new VaultManagerRestoreError("Destination path already exists; restore_note will not overwrite it.", "TARGET_EXISTS");
        throw error;
      });
      const after = await stat(absoluteTo);
      return { ...target, trashSourceExistsAfter: false, destinationExistsAfter: true, bytesAfter: after.size };
    });
  }

  async previewCopy(input: VaultCopyInput): Promise<CopyTargetSummary> {
    const safeFromPath = this.normalizeCopySourcePath(input.fromPath);
    const safeToPath = this.normalizeCopyDestinationPath(input.toPath);
    return this.inspectCopy(safeFromPath, safeToPath, false);
  }

  async commitCopy(input: VaultCopyInput): Promise<CopyTargetSummary> {
    const safeFromPath = this.normalizeCopySourcePath(input.fromPath);
    const safeToPath = this.normalizeCopyDestinationPath(input.toPath);
    const root = await this.vaultRootRealpath();
    return withTargetLocks([`${root}::${safeFromPath}`, `${root}::${safeToPath}`], async () => {
      const target = await this.inspectCopy(safeFromPath, safeToPath, true);
      const absoluteFrom = await this.absoluteTargetPath(safeFromPath);
      const absoluteTo = await this.absoluteTargetPath(safeToPath);
      await copyFile(absoluteFrom, absoluteTo, fsConstants.COPYFILE_EXCL).catch(async (error: unknown) => {
        if (isNodeError(error, "ENOENT")) {
          const sourceInfo = await lstat(absoluteFrom).catch(() => undefined);
          if (!sourceInfo) throw new VaultManagerCopyError("Source note is missing; copy_note will not create it.", "SOURCE_NOT_FOUND");
          throw new VaultManagerCopyError("Destination parent folder is missing; copy_note will not create it.", "PARENT_MISSING");
        }
        if (isNodeError(error, "EEXIST")) throw new VaultManagerCopyError("Destination note already exists; copy_note will not overwrite it.", "TARGET_EXISTS");
        if (isNodeError(error, "ENOTDIR")) throw new VaultManagerCopyError("Destination parent exists but is not a folder.", "PARENT_NOT_FOLDER");
        if (isNodeError(error, "EISDIR")) throw new VaultManagerCopyError("Destination path already exists; copy_note will not overwrite it.", "TARGET_EXISTS");
        throw error;
      });
      const after = await stat(absoluteTo);
      return { ...target, sourceExistsAfter: true, destinationExistsAfter: true, bytesAfter: after.size, bytesPreserved: after.size === target.bytesBefore };
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

  private async inspectRestore(trashPath: string, toPath: string, trashFolder: string, trashFolderDefaulted: boolean, forCommit: boolean): Promise<RestoreTargetSummary> {
    if (trashPath === toPath) throw new VaultManagerRestoreError("Restore source and destination must be different vault-relative Markdown paths.", "SAME_PATH");
    if (!isPathInsideFolder(trashPath, trashFolder)) throw new VaultManagerRestoreError("trashPath must be inside the selected trashFolder.", "TRASH_PATH_OUTSIDE_TRASH");

    const absoluteTrashFolder = await this.absoluteTargetPath(trashFolder);
    const absoluteTrashPath = await this.absoluteTargetPath(trashPath);
    const absoluteTo = await this.absoluteTargetPath(toPath);
    const parentPath = path.dirname(absoluteTo);

    const trashFolderInfo = await stat(absoluteTrashFolder).catch(() => undefined);
    if (trashFolderInfo) {
      await this.assertRealPathContained(absoluteTrashFolder, "Trash folder resolves outside the configured vault.");
      if (!trashFolderInfo.isDirectory()) throw new VaultManagerRestoreError("Selected trashFolder exists but is not a folder.", "TRASH_FOLDER_NOT_FOLDER");
    } else {
      await this.assertNearestExistingAncestorContained(absoluteTrashFolder);
    }

    const sourceInfo = await lstat(absoluteTrashPath).catch(() => undefined);
    if (!sourceInfo) throw new VaultManagerRestoreError("Trash source note does not exist; restore_note will not infer another note.", "TRASH_SOURCE_NOT_FOUND");
    await this.assertRealPathContained(absoluteTrashPath, "Trash source note resolves outside the configured vault.");
    if (sourceInfo.isDirectory()) throw new VaultManagerRestoreError("Trash source path is a folder; restore_note restores exactly one Markdown note only.", "TRASH_SOURCE_IS_FOLDER");
    if (!sourceInfo.isFile()) throw new VaultManagerRestoreError("Trash source path is not a regular Markdown note file.", "TRASH_SOURCE_NOT_FILE");

    const destinationEntry = await lstat(absoluteTo).catch(() => undefined);
    if (destinationEntry) throw new VaultManagerRestoreError("Destination path already exists; restore_note will not overwrite it.", "TARGET_EXISTS");

    const parentInfo = await stat(parentPath).catch(() => undefined);
    if (!parentInfo) throw new VaultManagerRestoreError("Destination parent folder does not exist; restore_note will not create it.", "PARENT_MISSING");
    await this.assertRealPathContained(parentPath, "Destination parent folder resolves outside the configured vault.");
    if (!parentInfo.isDirectory()) throw new VaultManagerRestoreError("Destination parent exists but is not a folder.", "PARENT_NOT_FOLDER");

    return {
      trashPath,
      toPath,
      trashFolder,
      targetKind: "markdown",
      trashFolderDefaulted,
      trashSourceExistsBefore: true,
      trashSourceExistsAfter: !forCommit,
      destinationExistsBefore: false,
      destinationExistsAfter: forCommit,
      parentExistsBefore: true,
      parentIsFolderBefore: true,
      wouldOverwrite: false,
      wouldCreateParent: false,
      wouldPermanentlyDelete: false,
      wouldRewriteLinks: false,
      bytesBefore: sourceInfo.size,
      bytesAfter: forCommit ? sourceInfo.size : undefined,
    };
  }

  private async inspectCopy(fromPath: string, toPath: string, forCommit: boolean): Promise<CopyTargetSummary> {
    if (fromPath === toPath) throw new VaultManagerCopyError("Copy source and destination must be different vault-relative Markdown paths.", "SAME_PATH");

    const absoluteFrom = await this.absoluteTargetPath(fromPath);
    const absoluteTo = await this.absoluteTargetPath(toPath);
    const parentPath = path.dirname(absoluteTo);

    const sourceInfo = await lstat(absoluteFrom).catch(() => undefined);
    if (!sourceInfo) throw new VaultManagerCopyError("Source note does not exist; copy_note will not infer or create it.", "SOURCE_NOT_FOUND");
    await this.assertRealPathContained(absoluteFrom, "Source note resolves outside the configured vault.");
    if (sourceInfo.isDirectory()) throw new VaultManagerCopyError("Source path is a folder; copy_note copies exactly one Markdown note only.", "SOURCE_IS_FOLDER");
    if (!sourceInfo.isFile()) throw new VaultManagerCopyError("Source path is not a regular Markdown note file.", "SOURCE_NOT_FILE");

    const destinationEntry = await lstat(absoluteTo).catch(() => undefined);
    if (destinationEntry) throw new VaultManagerCopyError("Destination path already exists; copy_note will not overwrite it.", "TARGET_EXISTS");

    const parentInfo = await stat(parentPath).catch(() => undefined);
    if (!parentInfo) throw new VaultManagerCopyError("Destination parent folder does not exist; copy_note will not create it.", "PARENT_MISSING");
    await this.assertRealPathContained(parentPath, "Destination parent folder resolves outside the configured vault.");
    if (!parentInfo.isDirectory()) throw new VaultManagerCopyError("Destination parent exists but is not a folder.", "PARENT_NOT_FOLDER");

    return {
      fromPath,
      toPath,
      targetKind: "markdown",
      sourceExistsBefore: true,
      sourceExistsAfter: true,
      destinationExistsBefore: false,
      destinationExistsAfter: forCommit,
      parentExistsBefore: true,
      parentIsFolderBefore: true,
      wouldOverwrite: false,
      wouldCreateParent: false,
      wouldMoveSource: false,
      wouldDeleteSource: false,
      wouldRewriteLinks: false,
      bytesBefore: sourceInfo.size,
      bytesAfter: forCommit ? sourceInfo.size : undefined,
      bytesPreserved: forCommit ? true : undefined,
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

function isPathInsideFolder(safePath: string, safeFolder: string): boolean {
  const relative = path.posix.relative(safeFolder, safePath);
  return relative !== "" && !relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative);
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
  if (error instanceof VaultManagerRestoreError) {
    if (error.code === "SAME_PATH" || error.code === "TRASH_SOURCE_NOT_MARKDOWN" || error.code === "TARGET_NOT_MARKDOWN") return { code: error.code, message: error.message, category: "validation" };
    if (error.code === "TRASH_SOURCE_NOT_FOUND" || error.code === "PARENT_MISSING") return { code: error.code, message: error.message, category: "not_found" };
    if (error.code === "TARGET_EXISTS" || error.code === "PARENT_NOT_FOLDER" || error.code === "TRASH_FOLDER_NOT_FOLDER") return { code: error.code, message: error.message, category: "conflict" };
    if (error.code === "TRASH_PATH_OUTSIDE_TRASH" || error.code === "TRASH_SOURCE_IS_FOLDER" || error.code === "TRASH_SOURCE_NOT_FILE") return { code: error.code, message: error.message, category: "safety" };
    return { code: "RESTORE_FAILED", message: error.message, category: "runtime" };
  }
  if (error instanceof VaultManagerCopyError) {
    if (error.code === "SAME_PATH" || error.code === "SOURCE_NOT_MARKDOWN" || error.code === "SOURCE_IS_FOLDER" || error.code === "SOURCE_NOT_FILE" || error.code === "TARGET_NOT_MARKDOWN") return { code: error.code, message: error.message, category: "validation" };
    if (error.code === "SOURCE_NOT_FOUND" || error.code === "PARENT_MISSING") return { code: error.code, message: error.message, category: "not_found" };
    if (error.code === "TARGET_EXISTS" || error.code === "PARENT_NOT_FOLDER") return { code: error.code, message: error.message, category: "conflict" };
    return { code: "COPY_FAILED", message: error.message, category: "runtime" };
  }
  if (error instanceof VaultManagerSetupError) return { code: error.code, message: error.message, category: "setup" };
  return { code: "MOVE_FAILED", message: "The note management operation could not be completed safely.", category: "runtime" };
}
