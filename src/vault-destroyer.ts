import { constants as fsConstants } from "node:fs";
import { access, lstat, readdir, readFile, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeExplicitMarkdownNotePath, normalizeTrashFolderTarget } from "./path-safety.js";
import { withTargetLock } from "./target-lock.js";
import type { DestroyFolderTargetSummary, DestroyNoteTargetSummary, EmptyTrashTargetSummary, ReplaceNoteTargetSummary } from "./destroy-types.js";

const MAX_DESTRUCTIVE_ENTRIES = 5_000;

export class VaultDestroyerSafetyError extends Error {
  constructor(message: string, public readonly code: "UNSAFE_PATH" | "PATH_NOT_ALLOWED" | "TARGET_IS_SYMLINK" | "TARGET_SPECIAL_FILE" | "FOLDER_TOO_LARGE" = "UNSAFE_PATH") {
    super(message);
    this.name = "VaultDestroyerSafetyError";
  }
}

export class VaultDestroyerSetupError extends Error {
  constructor(message: string, public readonly code: "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE") {
    super(message);
    this.name = "VaultDestroyerSetupError";
  }
}

export class VaultDestroyerTargetError extends Error {
  constructor(message: string, public readonly code: "TARGET_MISSING" | "TARGET_NOT_MARKDOWN" | "TARGET_IS_FOLDER" | "TARGET_NOT_FOLDER" | "TARGET_NOT_FILE") {
    super(message);
    this.name = "VaultDestroyerTargetError";
  }
}

export class VaultDestroyerRuntimeError extends Error {
  constructor(message: string, public readonly code: "DELETE_FAILED" | "REPLACE_FAILED" | "EMPTY_TRASH_FAILED") {
    super(message);
    this.name = "VaultDestroyerRuntimeError";
  }
}

export interface VaultDestroyer {
  normalizeNotePath(input: string): string;
  normalizeFolderPath(input: string): string;
  previewDeleteNote(path: string): Promise<{ target: DestroyNoteTargetSummary; content: string }>;
  commitDeleteNote(path: string): Promise<DestroyNoteTargetSummary>;
  previewReplaceNote(path: string, content: string): Promise<{ target: ReplaceNoteTargetSummary; contentBefore: string }>;
  commitReplaceNote(path: string, content: string): Promise<ReplaceNoteTargetSummary>;
  previewDeleteFolder(path: string): Promise<DestroyFolderTargetSummary>;
  commitDeleteFolder(path: string): Promise<DestroyFolderTargetSummary>;
  previewEmptyTrash(trashFolder: string): Promise<EmptyTrashTargetSummary>;
  commitEmptyTrash(trashFolder: string): Promise<EmptyTrashTargetSummary>;
}

export class LocalVaultDestroyer implements VaultDestroyer {
  private readonly root: string;
  private rootRealpath: Promise<string> | undefined;

  constructor(vaultRoot: string | undefined) {
    if (!vaultRoot) throw new VaultDestroyerSetupError("A local vault path is required for obsidian_destroy.", "VAULT_PATH_REQUIRED");
    this.root = vaultRoot;
  }

  normalizeNotePath(input: string): string {
    return normalizeExplicitMarkdownNotePath(input);
  }

  normalizeFolderPath(input: string): string {
    return normalizeTrashFolderTarget(input);
  }

  async previewDeleteNote(pathInput: string): Promise<{ target: DestroyNoteTargetSummary; content: string }> {
    const safePath = this.normalizeNotePath(pathInput);
    return this.inspectDeleteNote(safePath, false);
  }

  async commitDeleteNote(pathInput: string): Promise<DestroyNoteTargetSummary> {
    const safePath = this.normalizeNotePath(pathInput);
    return withTargetLock(`${await this.vaultRootRealpath()}::destroy::${safePath}`, async () => {
      const inspected = await this.inspectDeleteNote(safePath, true);
      const absolutePath = await this.absoluteTargetPath(safePath);
      await unlink(absolutePath).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) throw new VaultDestroyerTargetError("Target note does not exist.", "TARGET_MISSING");
        if (isNodeError(error, "EISDIR")) throw new VaultDestroyerTargetError("Target path is a folder, not a Markdown note.", "TARGET_IS_FOLDER");
        throw new VaultDestroyerRuntimeError("Permanent note deletion failed.", "DELETE_FAILED");
      });
      return inspected.target;
    });
  }

  async previewReplaceNote(pathInput: string, content: string): Promise<{ target: ReplaceNoteTargetSummary; contentBefore: string }> {
    const safePath = this.normalizeNotePath(pathInput);
    return this.inspectReplaceNote(safePath, content, false);
  }

  async commitReplaceNote(pathInput: string, content: string): Promise<ReplaceNoteTargetSummary> {
    const safePath = this.normalizeNotePath(pathInput);
    return withTargetLock(`${await this.vaultRootRealpath()}::destroy::${safePath}`, async () => {
      const inspected = await this.inspectReplaceNote(safePath, content, true);
      const absolutePath = await this.absoluteTargetPath(safePath);
      await writeFile(absolutePath, content, "utf8").catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) throw new VaultDestroyerTargetError("Target note does not exist; replace_note will not create it.", "TARGET_MISSING");
        throw new VaultDestroyerRuntimeError("Full-note replacement failed.", "REPLACE_FAILED");
      });
      const after = await stat(absolutePath);
      return { ...inspected.target, existsAfter: true, bytesAfter: after.size };
    });
  }

  async previewDeleteFolder(pathInput: string): Promise<DestroyFolderTargetSummary> {
    const safePath = this.normalizeFolderPath(pathInput);
    return this.inspectFolder(safePath, false, "folder");
  }

  async commitDeleteFolder(pathInput: string): Promise<DestroyFolderTargetSummary> {
    const safePath = this.normalizeFolderPath(pathInput);
    return withTargetLock(`${await this.vaultRootRealpath()}::destroy::${safePath}`, async () => {
      const target = await this.inspectFolder(safePath, true, "folder");
      const absolutePath = await this.absoluteTargetPath(safePath);
      await removeDirectoryTree(absolutePath);
      return { ...target, existsAfter: false };
    });
  }

  async previewEmptyTrash(trashFolderInput: string): Promise<EmptyTrashTargetSummary> {
    const safeTrashFolder = this.normalizeFolderPath(trashFolderInput);
    return this.inspectTrashFolder(safeTrashFolder, false);
  }

  async commitEmptyTrash(trashFolderInput: string): Promise<EmptyTrashTargetSummary> {
    const safeTrashFolder = this.normalizeFolderPath(trashFolderInput);
    return withTargetLock(`${await this.vaultRootRealpath()}::destroy::${safeTrashFolder}`, async () => {
      const target = await this.inspectTrashFolder(safeTrashFolder, true);
      const absolutePath = await this.absoluteTargetPath(safeTrashFolder);
      await removeDirectoryContents(absolutePath);
      return { ...target, existsAfter: true };
    });
  }

  private async inspectDeleteNote(safePath: string, forCommit: boolean): Promise<{ target: DestroyNoteTargetSummary; content: string }> {
    const absolutePath = await this.absoluteTargetPath(safePath);
    const info = await lstat(absolutePath).catch(() => undefined);
    if (!info) throw new VaultDestroyerTargetError("Target note does not exist; delete_note will not infer another note.", "TARGET_MISSING");
    await this.assertRealPathContained(absolutePath, "Target note resolves outside the configured vault.");
    if (info.isSymbolicLink()) throw new VaultDestroyerSafetyError("Symlink targets are refused for permanent deletion.", "TARGET_IS_SYMLINK");
    if (info.isDirectory()) throw new VaultDestroyerTargetError("Target path is a folder; use delete_folder only when permanent recursive folder deletion is intended.", "TARGET_IS_FOLDER");
    if (!info.isFile()) throw new VaultDestroyerSafetyError("Special files are refused for permanent deletion.", "TARGET_SPECIAL_FILE");
    const content = await readFile(absolutePath, "utf8");
    return { target: { path: safePath, targetKind: "markdown", existsBefore: true, existsAfter: !forCommit, bytesBefore: info.size }, content };
  }

  private async inspectReplaceNote(safePath: string, content: string, forCommit: boolean): Promise<{ target: ReplaceNoteTargetSummary; contentBefore: string }> {
    const existing = await this.inspectDeleteNote(safePath, false);
    return {
      target: {
        path: safePath,
        targetKind: "markdown",
        existsBefore: true,
        existsAfter: true,
        bytesBefore: existing.target.bytesBefore,
        bytesAfter: forCommit ? Buffer.byteLength(content, "utf8") : Buffer.byteLength(content, "utf8"),
      },
      contentBefore: existing.content,
    };
  }

  private async inspectFolder(safePath: string, forCommit: boolean, kind: "folder"): Promise<DestroyFolderTargetSummary> {
    const absolutePath = await this.absoluteTargetPath(safePath);
    const info = await lstat(absolutePath).catch(() => undefined);
    if (!info) throw new VaultDestroyerTargetError("Target folder does not exist; delete_folder will not infer another folder.", "TARGET_MISSING");
    await this.assertRealPathContained(absolutePath, "Target folder resolves outside the configured vault.");
    if (info.isSymbolicLink()) throw new VaultDestroyerSafetyError("Symlink folders are refused for permanent deletion.", "TARGET_IS_SYMLINK");
    if (!info.isDirectory()) throw new VaultDestroyerTargetError("Target path is not a folder.", "TARGET_NOT_FOLDER");
    const scan = await scanDirectoryContents(absolutePath, await this.vaultRootRealpath());
    return { path: safePath, targetKind: kind, existsBefore: true, existsAfter: !forCommit, ...scan };
  }

  private async inspectTrashFolder(safeTrashFolder: string, _forCommit: boolean): Promise<EmptyTrashTargetSummary> {
    const absolutePath = await this.absoluteTargetPath(safeTrashFolder);
    const info = await lstat(absolutePath).catch(() => undefined);
    if (!info) throw new VaultDestroyerTargetError("Trash folder does not exist; empty_trash has nothing explicit to empty.", "TARGET_MISSING");
    await this.assertRealPathContained(absolutePath, "Trash folder resolves outside the configured vault.");
    if (info.isSymbolicLink()) throw new VaultDestroyerSafetyError("Symlink trash folders are refused for empty_trash.", "TARGET_IS_SYMLINK");
    if (!info.isDirectory()) throw new VaultDestroyerTargetError("Trash path is not a folder.", "TARGET_NOT_FOLDER");
    const scan = await scanDirectoryContents(absolutePath, await this.vaultRootRealpath());
    return { trashFolder: safeTrashFolder, targetKind: "trash_folder", existsBefore: true, existsAfter: true, ...scan };
  }

  private async absoluteTargetPath(safePath: string): Promise<string> {
    const root = await this.vaultRootRealpath();
    const absolutePath = path.resolve(root, ...safePath.split("/"));
    assertContained(root, absolutePath, "Target path is outside the configured vault.");
    if (absolutePath === root) throw new VaultDestroyerSafetyError("The vault root is never a valid destructive target.", "PATH_NOT_ALLOWED");
    return absolutePath;
  }

  private async vaultRootRealpath(): Promise<string> {
    this.rootRealpath ??= realpath(this.root).then(async (resolved) => {
      const info = await stat(resolved).catch(() => undefined);
      if (!info?.isDirectory()) throw new VaultDestroyerSetupError("Configured vault path is not a directory.", "VAULT_NOT_ACCESSIBLE");
      await access(resolved, fsConstants.R_OK | fsConstants.W_OK).catch(() => {
        throw new VaultDestroyerSetupError("Configured vault path is not readable and writable for obsidian_destroy.", "VAULT_NOT_WRITABLE");
      });
      return resolved;
    }).catch((error: unknown) => {
      if (error instanceof VaultDestroyerSetupError) throw error;
      throw new VaultDestroyerSetupError("Configured vault path is not accessible.", "VAULT_NOT_ACCESSIBLE");
    });
    return this.rootRealpath;
  }

  private async assertRealPathContained(inputPath: string, message: string): Promise<void> {
    const root = await this.vaultRootRealpath();
    const resolved = await realpath(inputPath).catch(() => undefined);
    if (!resolved) return;
    assertContained(root, resolved, message);
  }
}

async function scanDirectoryContents(rootPath: string, vaultRoot: string): Promise<{ entryCount: number; fileCount: number; folderCount: number; bytesBefore: number }> {
  const scan = { entryCount: 0, fileCount: 0, folderCount: 0, bytesBefore: 0 };
  async function visit(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      scan.entryCount += 1;
      if (scan.entryCount > MAX_DESTRUCTIVE_ENTRIES) throw new VaultDestroyerSafetyError("Destructive folder operation refused because the target contains too many entries.", "FOLDER_TOO_LARGE");
      const absolute = path.join(dirPath, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new VaultDestroyerSafetyError("Symlink entries are refused for permanent destructive folder operations.", "TARGET_IS_SYMLINK");
      if (info.isDirectory()) {
        assertContained(vaultRoot, await realpath(absolute), "Nested folder resolves outside the configured vault.");
        scan.folderCount += 1;
        await visit(absolute);
      } else if (info.isFile()) {
        assertContained(vaultRoot, await realpath(absolute), "Nested file resolves outside the configured vault.");
        scan.fileCount += 1;
        scan.bytesBefore += info.size;
      } else {
        throw new VaultDestroyerSafetyError("Special files are refused for permanent destructive folder operations.", "TARGET_SPECIAL_FILE");
      }
    }
  }
  await visit(rootPath);
  return scan;
}

async function removeDirectoryTree(rootPath: string): Promise<void> {
  await removeDirectoryContents(rootPath);
  await rmdir(rootPath).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) throw new VaultDestroyerTargetError("Target folder disappeared before deletion.", "TARGET_MISSING");
    throw new VaultDestroyerRuntimeError("Permanent folder deletion failed.", "DELETE_FAILED");
  });
}

async function removeDirectoryContents(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dirPath, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new VaultDestroyerSafetyError("Symlink entries are refused for permanent destructive folder operations.", "TARGET_IS_SYMLINK");
    if (info.isDirectory()) {
      await removeDirectoryTree(absolute);
    } else if (info.isFile()) {
      await unlink(absolute);
    } else {
      throw new VaultDestroyerSafetyError("Special files are refused for permanent destructive folder operations.", "TARGET_SPECIAL_FILE");
    }
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new VaultDestroyerSafetyError(message, "UNSAFE_PATH");
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export function destroyErrorFromUnknown(error: unknown): { code: string; message: string; category: "validation" | "safety" | "not_found" | "conflict" | "setup" | "runtime" } {
  if (error instanceof PathSafetyError || error instanceof VaultDestroyerSafetyError) return { code: error instanceof VaultDestroyerSafetyError ? error.code : "UNSAFE_PATH", message: error.message, category: "safety" };
  if (error instanceof VaultDestroyerTargetError) {
    if (error.code === "TARGET_MISSING") return { code: error.code, message: error.message, category: "not_found" };
    if (error.code === "TARGET_NOT_MARKDOWN") return { code: error.code, message: error.message, category: "validation" };
    return { code: error.code, message: error.message, category: "conflict" };
  }
  if (error instanceof VaultDestroyerSetupError) return { code: error.code, message: error.message, category: "setup" };
  if (error instanceof VaultDestroyerRuntimeError) return { code: error.code, message: error.message, category: "runtime" };
  return { code: "DELETE_FAILED", message: "The destructive operation could not be completed safely.", category: "runtime" };
}
