import { PathSafetyError } from "./errors.js";
import { buildCopyPreview, buildMovePreview, buildRestorePreview, buildTrashPreview, makeManageError, makeManageOutput, normalizeManageOperation } from "./manage-guidance.js";
import { LocalVaultManager, manageErrorFromUnknown, type VaultManager } from "./vault-manager.js";
import type { ObsidianManageError, ObsidianManageOutput, ObsidianManageRequest } from "./manage-types.js";

export interface ObsidianManageOptions {
  vaultRoot?: string | undefined;
  manager?: VaultManager | undefined;
}

const DEFAULT_TRASH_FOLDER = "_Trash";

export async function obsidianManage(request: ObsidianManageRequest, options: ObsidianManageOptions = {}): Promise<ObsidianManageOutput> {
  const dryRun = request.dryRun ?? true;
  const op = normalizeManageOperation(request.operation);
  const requestedOperation = op.requested ?? request.operation?.trim();

  if (!request.operation?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      dryRun,
      message: "obsidian_manage requires operation=move_note, operation=trash_note, operation=restore_note, or operation=copy_note.",
      error: makeManageError("MISSING_OPERATION", "validation", "Provide operation=move_note, operation=trash_note, operation=restore_note, or operation=copy_note."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeManageOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      message: "obsidian_manage supports only move_note, trash_note, restore_note, and copy_note; the requested operation was refused.",
      error: makeManageError(code, "safety", "Use only operation=move_note, operation=trash_note, operation=restore_note, or operation=copy_note. Folder moves/copies, permanent delete, recursive or wildcard/bulk operations, overwrite, link rewrite, UI, shell, network, scan, discovery, and arbitrary command operations are not supported."),
      warnings: ["Forbidden or unsupported management operation refused; no note or folder was changed."],
    });
  }

  if (op.operation === "trash_note") return handleTrashNote(request, dryRun, options);
  if (op.operation === "restore_note") return handleRestoreNote(request, dryRun, options);
  if (op.operation === "copy_note") return handleCopyNote(request, dryRun, options);
  return handleMoveNote(request, dryRun, options);
}

async function managerFromOptions(options: ObsidianManageOptions): Promise<VaultManager> {
  return options.manager ?? new LocalVaultManager(options.vaultRoot);
}

async function handleMoveNote(request: ObsidianManageRequest, dryRun: boolean, options: ObsidianManageOptions): Promise<ObsidianManageOutput> {
  const operation = "move_note";
  if (!request.fromPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage move_note requires an explicit source Markdown note path.",
      error: makeManageError("MISSING_FROM_PATH", "validation", "Provide an explicit safe vault-relative Markdown fromPath; obsidian_manage will not infer one."),
    });
  }

  if (!request.toPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage move_note requires an explicit destination Markdown note path.",
      error: makeManageError("MISSING_TO_PATH", "validation", "Provide an explicit safe vault-relative Markdown toPath; obsidian_manage will not infer one."),
    });
  }

  let manager: VaultManager;
  try {
    manager = await managerFromOptions(options);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "setup_required",
      operation,
      dryRun,
      message: "A local Obsidian vault path is required before obsidian_manage can run.",
      error: makeManageError("VAULT_PATH_REQUIRED", "setup", "Configure OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json with a vaultPath before managing notes."),
      warnings: [mapped.message],
    });
  }

  let safeFromPath: string;
  try {
    safeFromPath = manager.normalizePath(request.fromPath);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      dryRun,
      message: "The source path is not safe for obsidian_manage move_note.",
      error: makeManageError("UNSAFE_FROM_PATH", "safety", mapped.message),
      warnings: ["Unsafe source path refused; no note or folder was changed."],
    });
  }

  let safeToPath: string;
  try {
    safeToPath = manager.normalizePath(request.toPath);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      fromPath: safeFromPath,
      dryRun,
      message: "The destination path is not safe for obsidian_manage move_note.",
      error: makeManageError("UNSAFE_TO_PATH", "safety", mapped.message),
      warnings: ["Unsafe destination path refused; no note or folder was changed."],
    });
  }

  if (safeFromPath === safeToPath) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      fromPath: safeFromPath,
      toPath: safeToPath,
      dryRun,
      message: "obsidian_manage move_note requires different source and destination note paths.",
      error: makeManageError("SAME_PATH", "validation", "Choose a destination Markdown path that differs from the source after normalization."),
      warnings: ["Same-path move refused; no note was changed."],
    });
  }

  try {
    if (dryRun) {
      const target = await manager.preview({ fromPath: safeFromPath, toPath: safeToPath });
      const preview = buildMovePreview(target);
      return makeManageOutput({
        status: "preview",
        operation,
        fromPath: safeFromPath,
        toPath: safeToPath,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_manage would move ${safeFromPath} to ${safeToPath}.`,
        target,
        preview,
      });
    }

    const target = await manager.commit({ fromPath: safeFromPath, toPath: safeToPath });
    return makeManageOutput({
      status: "success",
      operation,
      fromPath: safeFromPath,
      toPath: safeToPath,
      dryRun,
      committed: true,
      message: `obsidian_manage move_note committed from ${safeFromPath} to ${safeToPath}.`,
      target,
    });
  } catch (error) {
    return mapMoveFailure(error, safeFromPath, safeToPath, dryRun);
  }
}

async function handleCopyNote(request: ObsidianManageRequest, dryRun: boolean, options: ObsidianManageOptions): Promise<ObsidianManageOutput> {
  const operation = "copy_note";
  if (!request.fromPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage copy_note requires an explicit source Markdown note path.",
      error: makeManageError("MISSING_FROM_PATH", "validation", "Provide an explicit safe vault-relative Markdown fromPath; obsidian_manage will not infer one."),
    });
  }

  if (!request.toPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage copy_note requires an explicit destination Markdown note path.",
      error: makeManageError("MISSING_TO_PATH", "validation", "Provide an explicit safe vault-relative Markdown toPath; obsidian_manage will not infer one."),
    });
  }

  let manager: VaultManager;
  try {
    manager = await managerFromOptions(options);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "setup_required",
      operation,
      dryRun,
      message: "A local Obsidian vault path is required before obsidian_manage can run.",
      error: makeManageError("VAULT_PATH_REQUIRED", "setup", "Configure OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json with a vaultPath before managing notes."),
      warnings: [mapped.message],
    });
  }

  let safeFromPath: string;
  try {
    safeFromPath = manager.normalizeCopySourcePath(request.fromPath);
  } catch (error) {
    if (error instanceof PathSafetyError && error.code === "NON_MARKDOWN") {
      return makeManageOutput({
        status: "validation_error",
        operation,
        dryRun,
        message: "obsidian_manage copy_note requires a Markdown source path.",
        error: makeManageError("SOURCE_NOT_MARKDOWN", "validation", "Provide an explicit safe vault-relative Markdown .md fromPath."),
        warnings: ["Non-Markdown source path refused; no note or folder was changed."],
      });
    }
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      dryRun,
      message: "The source path is not safe for obsidian_manage copy_note.",
      error: makeManageError("UNSAFE_FROM_PATH", "safety", mapped.message),
      warnings: ["Unsafe source path refused; no note or folder was changed."],
    });
  }

  let safeToPath: string;
  try {
    safeToPath = manager.normalizeCopyDestinationPath(request.toPath);
  } catch (error) {
    if (error instanceof PathSafetyError && error.code === "NON_MARKDOWN") {
      return makeManageOutput({
        status: "validation_error",
        operation,
        fromPath: safeFromPath,
        dryRun,
        message: "obsidian_manage copy_note requires a Markdown destination path.",
        error: makeManageError("TARGET_NOT_MARKDOWN", "validation", "Provide an explicit safe vault-relative Markdown .md toPath."),
        warnings: ["Non-Markdown destination path refused; no note or folder was changed."],
      });
    }
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      fromPath: safeFromPath,
      dryRun,
      message: "The destination path is not safe for obsidian_manage copy_note.",
      error: makeManageError("UNSAFE_TO_PATH", "safety", mapped.message),
      warnings: ["Unsafe destination path refused; no note or folder was changed."],
    });
  }

  if (safeFromPath === safeToPath) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      fromPath: safeFromPath,
      toPath: safeToPath,
      dryRun,
      message: "obsidian_manage copy_note requires different source and destination note paths.",
      error: makeManageError("SAME_PATH", "validation", "Choose a destination Markdown path that differs from fromPath after normalization."),
      warnings: ["Same-path copy refused; no note was changed."],
    });
  }

  try {
    if (dryRun) {
      const target = await manager.previewCopy({ fromPath: safeFromPath, toPath: safeToPath });
      const preview = buildCopyPreview(target);
      return makeManageOutput({
        status: "preview",
        operation,
        fromPath: safeFromPath,
        toPath: safeToPath,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_manage would copy ${safeFromPath} to ${safeToPath}.`,
        target,
        preview,
      });
    }

    const target = await manager.commitCopy({ fromPath: safeFromPath, toPath: safeToPath });
    return makeManageOutput({
      status: "success",
      operation,
      fromPath: safeFromPath,
      toPath: safeToPath,
      dryRun,
      committed: true,
      message: `obsidian_manage copy_note committed from ${safeFromPath} to ${safeToPath}.`,
      target,
    });
  } catch (error) {
    return mapCopyFailure(error, safeFromPath, safeToPath, dryRun);
  }
}

async function handleTrashNote(request: ObsidianManageRequest, dryRun: boolean, options: ObsidianManageOptions): Promise<ObsidianManageOutput> {
  const operation = "trash_note";
  if (!request.path?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage trash_note requires an explicit source Markdown note path.",
      error: makeManageError("MISSING_PATH", "validation", "Provide an explicit safe vault-relative Markdown path; obsidian_manage will not infer one."),
    });
  }

  let manager: VaultManager;
  try {
    manager = await managerFromOptions(options);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "setup_required",
      operation,
      dryRun,
      message: "A local Obsidian vault path is required before obsidian_manage can run.",
      error: makeManageError("VAULT_PATH_REQUIRED", "setup", "Configure OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json with a vaultPath before managing notes."),
      warnings: [mapped.message],
    });
  }

  let safePath: string;
  try {
    safePath = manager.normalizeTrashSourcePath(request.path);
  } catch (error) {
    const code = error instanceof PathSafetyError && error.code === "NON_MARKDOWN" ? "SOURCE_NOT_MARKDOWN" : undefined;
    if (code === "SOURCE_NOT_MARKDOWN") {
      return makeManageOutput({
        status: "validation_error",
        operation,
        dryRun,
        message: "obsidian_manage trash_note requires a Markdown source note path.",
        error: makeManageError("SOURCE_NOT_MARKDOWN", "validation", "Provide an explicit safe vault-relative Markdown .md path."),
        warnings: ["Non-Markdown source path refused; no note or folder was changed."],
      });
    }
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      dryRun,
      message: "The source path is not safe for obsidian_manage trash_note.",
      error: makeManageError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe source path refused; no note or folder was changed."],
    });
  }

  const trashFolderInput = request.trashFolder === undefined ? DEFAULT_TRASH_FOLDER : request.trashFolder;
  const trashFolderDefaulted = request.trashFolder === undefined;
  let safeTrashFolder: string;
  try {
    safeTrashFolder = manager.normalizeTrashFolderPath(trashFolderInput);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      path: safePath,
      dryRun,
      message: "The trashFolder path is not safe for obsidian_manage trash_note.",
      error: makeManageError("UNSAFE_TRASH_FOLDER", "safety", mapped.message),
      warnings: ["Unsafe trash folder refused; no note or folder was changed."],
    });
  }

  const trashPath = `${safeTrashFolder}/${safePath.split("/").at(-1) ?? safePath}`;

  try {
    if (dryRun) {
      const target = await manager.previewTrash({ path: safePath, trashFolder: safeTrashFolder, trashFolderDefaulted });
      const preview = buildTrashPreview(target);
      return makeManageOutput({
        status: "preview",
        operation,
        path: safePath,
        trashFolder: safeTrashFolder,
        trashPath: target.trashPath,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_manage would move ${safePath} to trash at ${target.trashPath}.`,
        target,
        preview,
        warnings: target.trashFolderWouldBeCreated ? [`Trash folder ${safeTrashFolder} would be created only if dryRun=false is explicitly supplied.`] : [],
      });
    }

    const target = await manager.commitTrash({ path: safePath, trashFolder: safeTrashFolder, trashFolderDefaulted });
    return makeManageOutput({
      status: "success",
      operation,
      path: safePath,
      trashFolder: safeTrashFolder,
      trashPath: target.trashPath,
      dryRun,
      committed: true,
      message: `obsidian_manage trash_note committed from ${safePath} to ${target.trashPath}.`,
      target,
    });
  } catch (error) {
    return mapTrashFailure(error, safePath, safeTrashFolder, trashPath, dryRun);
  }
}

async function handleRestoreNote(request: ObsidianManageRequest, dryRun: boolean, options: ObsidianManageOptions): Promise<ObsidianManageOutput> {
  const operation = "restore_note";
  if (!request.trashPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage restore_note requires an explicit trashed Markdown note path.",
      error: makeManageError("MISSING_TRASH_PATH", "validation", "Provide an explicit safe vault-relative Markdown trashPath inside the selected trashFolder; obsidian_manage will not infer one."),
    });
  }

  if (!request.toPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      dryRun,
      message: "obsidian_manage restore_note requires an explicit destination Markdown note path.",
      error: makeManageError("MISSING_TO_PATH", "validation", "Provide an explicit safe vault-relative Markdown toPath; obsidian_manage will not infer one."),
    });
  }

  let manager: VaultManager;
  try {
    manager = await managerFromOptions(options);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "setup_required",
      operation,
      dryRun,
      message: "A local Obsidian vault path is required before obsidian_manage can run.",
      error: makeManageError("VAULT_PATH_REQUIRED", "setup", "Configure OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json with a vaultPath before managing notes."),
      warnings: [mapped.message],
    });
  }

  let safeTrashPath: string;
  try {
    safeTrashPath = manager.normalizeRestoreTrashPath(request.trashPath);
  } catch (error) {
    if (error instanceof PathSafetyError && error.code === "NON_MARKDOWN") {
      return makeManageOutput({
        status: "validation_error",
        operation,
        dryRun,
        message: "obsidian_manage restore_note requires a Markdown trashPath.",
        error: makeManageError("TRASH_SOURCE_NOT_MARKDOWN", "validation", "Provide an explicit safe vault-relative Markdown .md trashPath inside the selected trashFolder."),
        warnings: ["Non-Markdown trashPath refused; no note or folder was changed."],
      });
    }
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      dryRun,
      message: "The trashPath is not safe for obsidian_manage restore_note.",
      error: makeManageError("UNSAFE_TRASH_PATH", "safety", mapped.message),
      warnings: ["Unsafe trashPath refused; no note or folder was changed."],
    });
  }

  let safeToPath: string;
  try {
    safeToPath = manager.normalizeRestoreDestinationPath(request.toPath);
  } catch (error) {
    if (error instanceof PathSafetyError && error.code === "NON_MARKDOWN") {
      return makeManageOutput({
        status: "validation_error",
        operation,
        trashPath: safeTrashPath,
        dryRun,
        message: "obsidian_manage restore_note requires a Markdown destination path.",
        error: makeManageError("TARGET_NOT_MARKDOWN", "validation", "Provide an explicit safe vault-relative Markdown .md toPath."),
        warnings: ["Non-Markdown destination path refused; no note or folder was changed."],
      });
    }
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      trashPath: safeTrashPath,
      dryRun,
      message: "The destination path is not safe for obsidian_manage restore_note.",
      error: makeManageError("UNSAFE_TO_PATH", "safety", mapped.message),
      warnings: ["Unsafe destination path refused; no note or folder was changed."],
    });
  }

  if (safeTrashPath === safeToPath) {
    return makeManageOutput({
      status: "validation_error",
      operation,
      trashPath: safeTrashPath,
      toPath: safeToPath,
      dryRun,
      message: "obsidian_manage restore_note requires different trash source and destination note paths.",
      error: makeManageError("SAME_PATH", "validation", "Choose a destination Markdown path that differs from trashPath after normalization."),
      warnings: ["Same-path restore refused; no note was changed."],
    });
  }

  const trashFolderInput = request.trashFolder === undefined ? DEFAULT_TRASH_FOLDER : request.trashFolder;
  const trashFolderDefaulted = request.trashFolder === undefined;
  let safeTrashFolder: string;
  try {
    safeTrashFolder = manager.normalizeTrashFolderPath(trashFolderInput);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      trashPath: safeTrashPath,
      toPath: safeToPath,
      dryRun,
      message: "The trashFolder path is not safe for obsidian_manage restore_note.",
      error: makeManageError("UNSAFE_TRASH_FOLDER", "safety", mapped.message),
      warnings: ["Unsafe trash folder refused; no note or folder was changed."],
    });
  }

  if (!isPathInsideFolder(safeTrashPath, safeTrashFolder)) {
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      trashPath: safeTrashPath,
      toPath: safeToPath,
      trashFolder: safeTrashFolder,
      dryRun,
      committed: false,
      message: "restore_note refused because trashPath is outside the selected trashFolder.",
      error: makeManageError("TRASH_PATH_OUTSIDE_TRASH", "safety", "Provide a trashPath that is contained within the default or explicit safe trashFolder."),
      warnings: ["Trash path containment failed; no note or folder was changed."],
    });
  }

  try {
    if (dryRun) {
      const target = await manager.previewRestore({ trashPath: safeTrashPath, toPath: safeToPath, trashFolder: safeTrashFolder, trashFolderDefaulted });
      const preview = buildRestorePreview(target);
      return makeManageOutput({
        status: "preview",
        operation,
        trashPath: safeTrashPath,
        toPath: safeToPath,
        trashFolder: safeTrashFolder,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_manage would restore ${safeTrashPath} to ${safeToPath}.`,
        target,
        preview,
      });
    }

    const target = await manager.commitRestore({ trashPath: safeTrashPath, toPath: safeToPath, trashFolder: safeTrashFolder, trashFolderDefaulted });
    return makeManageOutput({
      status: "success",
      operation,
      trashPath: safeTrashPath,
      toPath: safeToPath,
      trashFolder: safeTrashFolder,
      dryRun,
      committed: true,
      message: `obsidian_manage restore_note committed from ${safeTrashPath} to ${safeToPath}.`,
      target,
    });
  } catch (error) {
    return mapRestoreFailure(error, safeTrashPath, safeToPath, safeTrashFolder, dryRun);
  }
}

function mapMoveFailure(error: unknown, fromPath: string, toPath: string, dryRun: boolean): ObsidianManageOutput {
  const mapped = manageErrorFromUnknown(error);
  const operation = "move_note";
  if (mapped.category === "not_found") {
    const code = mapped.code === "PARENT_MISSING" ? "PARENT_MISSING" : "SOURCE_NOT_FOUND";
    const message = code === "PARENT_MISSING" ? "move_note refused because the destination parent folder is missing." : "move_note refused because the source note does not exist.";
    return makeManageOutput({
      status: "not_found",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message,
      error: makeManageError(code, "not_found", mapped.message),
      warnings: [code === "PARENT_MISSING" ? "Missing destination parent folder was not created." : "Missing source note was not created or inferred."],
    });
  }

  if (mapped.category === "conflict") {
    const code = conflictCode(mapped.code);
    return makeManageOutput({
      status: "conflict",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: conflictMessage(code),
      error: makeManageError(code, "conflict", mapped.message),
      warnings: [conflictWarning(code)],
    });
  }

  if (mapped.category === "safety") {
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: "The requested note move is not safe for obsidian_manage.",
      error: makeManageError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe move refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "setup") {
    const code = setupCode(mapped.code);
    return makeManageOutput({
      status: "setup_required",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: "obsidian_manage setup is incomplete for local vault management.",
      error: makeManageError(code, "setup", mapped.message),
      warnings: ["Configure an accessible readable and writable local vault path before retrying."],
    });
  }

  return makeManageOutput({
    status: "manage_failed",
    operation,
    fromPath,
    toPath,
    dryRun,
    committed: false,
    message: "obsidian_manage could not complete the note move safely.",
    error: makeManageError("MOVE_FAILED", "runtime", "The move failed before a safe success result could be produced."),
    warnings: ["No overwrite, folder move, delete, copy, link rewrite, open, shell, network, scan, or arbitrary command action was attempted."],
  });
}

function mapTrashFailure(error: unknown, safePath: string, trashFolder: string, trashPath: string, dryRun: boolean): ObsidianManageOutput {
  const mapped = manageErrorFromUnknown(error);
  const operation = "trash_note";
  if (mapped.category === "not_found") {
    return makeManageOutput({
      status: "not_found",
      operation,
      path: safePath,
      trashFolder,
      trashPath,
      dryRun,
      committed: false,
      message: "trash_note refused because the source note does not exist.",
      error: makeManageError("SOURCE_NOT_FOUND", "not_found", mapped.message),
      warnings: ["Missing source note was not created or inferred; trash folder was not created."],
    });
  }

  if (mapped.category === "validation") {
    return makeManageOutput({
      status: "validation_error",
      operation,
      path: safePath,
      trashFolder,
      trashPath,
      dryRun,
      committed: false,
      message: "trash_note requires a safe Markdown source note path.",
      error: makeManageError("SOURCE_NOT_MARKDOWN", "validation", mapped.message),
      warnings: ["Non-Markdown source path refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "conflict") {
    const code = mapped.code === "TRASH_FOLDER_NOT_FOLDER" ? "TRASH_FOLDER_NOT_FOLDER" : "TRASH_TARGET_EXISTS";
    return makeManageOutput({
      status: "conflict",
      operation,
      path: safePath,
      trashFolder,
      trashPath,
      dryRun,
      committed: false,
      message: code === "TRASH_FOLDER_NOT_FOLDER" ? "trash_note refused because the configured trash folder path exists but is not a folder." : "trash_note refused because the final trash path already exists.",
      error: makeManageError(code, "conflict", mapped.message),
      warnings: [code === "TRASH_FOLDER_NOT_FOLDER" ? "Trash folder file or non-folder entry was not modified." : "Existing trash target was not overwritten, suffixed, or auto-renamed."],
    });
  }

  if (mapped.category === "safety") {
    const code = mapped.code === "SOURCE_IS_FOLDER" ? "SOURCE_IS_FOLDER" : mapped.code === "SOURCE_NOT_FILE" ? "SOURCE_NOT_FILE" : "UNSAFE_PATH";
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      path: safePath,
      trashFolder,
      trashPath,
      dryRun,
      committed: false,
      message: code === "SOURCE_IS_FOLDER" ? "trash_note refused because the source path is a folder." : code === "SOURCE_NOT_FILE" ? "trash_note refused because the source path is not a regular Markdown note file." : "The requested note trash operation is not safe for obsidian_manage.",
      error: makeManageError(code, "safety", mapped.message),
      warnings: ["Unsafe trash operation refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "setup") {
    const code = setupCode(mapped.code);
    return makeManageOutput({
      status: "setup_required",
      operation,
      path: safePath,
      trashFolder,
      trashPath,
      dryRun,
      committed: false,
      message: "obsidian_manage setup is incomplete for local vault management.",
      error: makeManageError(code, "setup", mapped.message),
      warnings: ["Configure an accessible readable and writable local vault path before retrying."],
    });
  }

  return makeManageOutput({
    status: "manage_failed",
    operation,
    path: safePath,
    trashFolder,
    trashPath,
    dryRun,
    committed: false,
    message: "obsidian_manage could not complete the note trash operation safely.",
    error: makeManageError("TRASH_FAILED", "runtime", "The trash operation failed before a safe success result could be produced."),
    warnings: ["No permanent delete, folder delete, recursive delete, wildcard delete, bulk delete, overwrite, copy, link rewrite, open, shell, network, scan, or arbitrary command action was attempted."],
  });
}

function mapRestoreFailure(error: unknown, trashPath: string, toPath: string, trashFolder: string, dryRun: boolean): ObsidianManageOutput {
  const mapped = manageErrorFromUnknown(error);
  const operation = "restore_note";
  if (mapped.category === "not_found") {
    const code = mapped.code === "PARENT_MISSING" ? "PARENT_MISSING" : "TRASH_SOURCE_NOT_FOUND";
    return makeManageOutput({
      status: "not_found",
      operation,
      trashPath,
      toPath,
      trashFolder,
      dryRun,
      committed: false,
      message: code === "PARENT_MISSING" ? "restore_note refused because the destination parent folder is missing." : "restore_note refused because the trash source note does not exist.",
      error: makeManageError(code, "not_found", mapped.message),
      warnings: [code === "PARENT_MISSING" ? "Missing destination parent folder was not created." : "Missing trash source note was not inferred, searched, or recreated."],
    });
  }

  if (mapped.category === "validation") {
    const code = mapped.code === "TARGET_NOT_MARKDOWN" ? "TARGET_NOT_MARKDOWN" : mapped.code === "SAME_PATH" ? "SAME_PATH" : "TRASH_SOURCE_NOT_MARKDOWN";
    return makeManageOutput({
      status: "validation_error",
      operation,
      trashPath,
      toPath,
      trashFolder,
      dryRun,
      committed: false,
      message: code === "SAME_PATH" ? "restore_note requires different trash source and destination note paths." : code === "TARGET_NOT_MARKDOWN" ? "restore_note requires a Markdown destination path." : "restore_note requires a Markdown trash source path.",
      error: makeManageError(code, "validation", mapped.message),
      warnings: ["Invalid restore request refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "conflict") {
    const code = mapped.code === "PARENT_NOT_FOLDER" ? "PARENT_NOT_FOLDER" : mapped.code === "TRASH_FOLDER_NOT_FOLDER" ? "TRASH_FOLDER_NOT_FOLDER" : "TARGET_EXISTS";
    return makeManageOutput({
      status: "conflict",
      operation,
      trashPath,
      toPath,
      trashFolder,
      dryRun,
      committed: false,
      message: code === "PARENT_NOT_FOLDER" ? "restore_note refused because the destination parent exists but is not a folder." : code === "TRASH_FOLDER_NOT_FOLDER" ? "restore_note refused because the selected trashFolder exists but is not a folder." : "restore_note refused because the destination path already exists.",
      error: makeManageError(code, "conflict", mapped.message),
      warnings: [code === "TARGET_EXISTS" ? "Existing destination was not overwritten, suffixed, or auto-renamed." : "Blocking non-folder entry was not modified."],
    });
  }

  if (mapped.category === "safety") {
    const code = mapped.code === "TRASH_SOURCE_IS_FOLDER" ? "TRASH_SOURCE_IS_FOLDER" : mapped.code === "TRASH_SOURCE_NOT_FILE" ? "TRASH_SOURCE_NOT_FILE" : mapped.code === "TRASH_PATH_OUTSIDE_TRASH" ? "TRASH_PATH_OUTSIDE_TRASH" : "UNSAFE_TRASH_PATH";
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      trashPath,
      toPath,
      trashFolder,
      dryRun,
      committed: false,
      message: code === "TRASH_SOURCE_IS_FOLDER" ? "restore_note refused because the trash source path is a folder." : code === "TRASH_SOURCE_NOT_FILE" ? "restore_note refused because the trash source path is not a regular Markdown note file." : code === "TRASH_PATH_OUTSIDE_TRASH" ? "restore_note refused because trashPath is outside the selected trashFolder." : "The requested note restore operation is not safe for obsidian_manage.",
      error: makeManageError(code, "safety", mapped.message),
      warnings: ["Unsafe restore operation refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "setup") {
    const code = setupCode(mapped.code);
    return makeManageOutput({
      status: "setup_required",
      operation,
      trashPath,
      toPath,
      trashFolder,
      dryRun,
      committed: false,
      message: "obsidian_manage setup is incomplete for local vault management.",
      error: makeManageError(code, "setup", mapped.message),
      warnings: ["Configure an accessible readable and writable local vault path before retrying."],
    });
  }

  return makeManageOutput({
    status: "manage_failed",
    operation,
    trashPath,
    toPath,
    trashFolder,
    dryRun,
    committed: false,
    message: "obsidian_manage could not complete the note restore operation safely.",
    error: makeManageError("RESTORE_FAILED", "runtime", "The restore operation failed before a safe success result could be produced."),
    warnings: ["No overwrite, auto-rename, copy, parent creation, link rewrite, open, shell, network, scan, or arbitrary command action was attempted."],
  });
}

function mapCopyFailure(error: unknown, fromPath: string, toPath: string, dryRun: boolean): ObsidianManageOutput {
  const mapped = manageErrorFromUnknown(error);
  const operation = "copy_note";
  if (mapped.category === "not_found") {
    const code = mapped.code === "PARENT_MISSING" ? "PARENT_MISSING" : "SOURCE_NOT_FOUND";
    return makeManageOutput({
      status: "not_found",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: code === "PARENT_MISSING" ? "copy_note refused because the destination parent folder is missing." : "copy_note refused because the source note does not exist.",
      error: makeManageError(code, "not_found", mapped.message),
      warnings: [code === "PARENT_MISSING" ? "Missing destination parent folder was not created." : "Missing source note was not created or inferred."],
    });
  }

  if (mapped.category === "validation") {
    const code = mapped.code === "SOURCE_IS_FOLDER" ? "SOURCE_IS_FOLDER" : mapped.code === "SOURCE_NOT_FILE" ? "SOURCE_NOT_FILE" : mapped.code === "TARGET_NOT_MARKDOWN" ? "TARGET_NOT_MARKDOWN" : mapped.code === "SAME_PATH" ? "SAME_PATH" : "SOURCE_NOT_MARKDOWN";
    return makeManageOutput({
      status: "validation_error",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: code === "SAME_PATH" ? "copy_note requires different source and destination note paths." : code === "TARGET_NOT_MARKDOWN" ? "copy_note requires a Markdown destination path." : code === "SOURCE_IS_FOLDER" ? "copy_note refused because the source path is a folder." : code === "SOURCE_NOT_FILE" ? "copy_note refused because the source path is not a regular Markdown note file." : "copy_note requires a Markdown source note path.",
      error: makeManageError(code, "validation", mapped.message),
      warnings: ["Invalid copy request refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "conflict") {
    const code = mapped.code === "PARENT_NOT_FOLDER" ? "PARENT_NOT_FOLDER" : "TARGET_EXISTS";
    return makeManageOutput({
      status: "conflict",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: code === "PARENT_NOT_FOLDER" ? "copy_note refused because the destination parent exists but is not a folder." : "copy_note refused because the destination path already exists.",
      error: makeManageError(code, "conflict", mapped.message),
      warnings: [code === "TARGET_EXISTS" ? "Existing destination was not overwritten, suffixed, or auto-renamed." : "Blocking non-folder entry was not modified."],
    });
  }

  if (mapped.category === "safety") {
    return makeManageOutput({
      status: "safety_refusal",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: "The requested note copy is not safe for obsidian_manage.",
      error: makeManageError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe copy refused; no note or folder was changed."],
    });
  }

  if (mapped.category === "setup") {
    const code = setupCode(mapped.code);
    return makeManageOutput({
      status: "setup_required",
      operation,
      fromPath,
      toPath,
      dryRun,
      committed: false,
      message: "obsidian_manage setup is incomplete for local vault management.",
      error: makeManageError(code, "setup", mapped.message),
      warnings: ["Configure an accessible readable and writable local vault path before retrying."],
    });
  }

  return makeManageOutput({
    status: "manage_failed",
    operation,
    fromPath,
    toPath,
    dryRun,
    committed: false,
    message: "obsidian_manage could not complete the note copy operation safely.",
    error: makeManageError("COPY_FAILED", "runtime", "The copy operation failed before a safe success result could be produced."),
    warnings: ["No overwrite, folder copy, recursive copy, wildcard copy, bulk copy, link rewrite, open, shell, network, scan, or arbitrary command action was attempted."],
  });
}

function isPathInsideFolder(safePath: string, safeFolder: string): boolean {
  const relative = safePath.startsWith(`${safeFolder}/`) ? safePath.slice(safeFolder.length + 1) : "";
  return relative.length > 0 && !relative.startsWith("../") && !relative.includes("/../");
}

function setupCode(code: string): Extract<ObsidianManageError["code"], "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE"> {
  return code === "VAULT_NOT_WRITABLE" ? "VAULT_NOT_WRITABLE" : code === "VAULT_NOT_ACCESSIBLE" ? "VAULT_NOT_ACCESSIBLE" : "VAULT_PATH_REQUIRED";
}

function conflictCode(code: string): Extract<ObsidianManageError["code"], "SOURCE_NOT_NOTE" | "TARGET_EXISTS" | "PARENT_NOT_FOLDER"> {
  if (code === "SOURCE_NOT_NOTE") return "SOURCE_NOT_NOTE";
  if (code === "PARENT_NOT_FOLDER") return "PARENT_NOT_FOLDER";
  return "TARGET_EXISTS";
}

function conflictMessage(code: "SOURCE_NOT_NOTE" | "TARGET_EXISTS" | "PARENT_NOT_FOLDER"): string {
  switch (code) {
    case "SOURCE_NOT_NOTE":
      return "move_note refused because the source path is not an existing Markdown note file.";
    case "PARENT_NOT_FOLDER":
      return "move_note refused because the destination parent exists but is not a folder.";
    case "TARGET_EXISTS":
      return "move_note refused because the destination path already exists.";
  }
}

function conflictWarning(code: "SOURCE_NOT_NOTE" | "TARGET_EXISTS" | "PARENT_NOT_FOLDER"): string {
  switch (code) {
    case "SOURCE_NOT_NOTE":
      return "Source folder or non-note entry was not moved.";
    case "PARENT_NOT_FOLDER":
      return "Destination parent file or non-folder entry was not modified.";
    case "TARGET_EXISTS":
      return "Existing destination was not overwritten.";
  }
}
