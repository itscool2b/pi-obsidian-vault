import { buildMovePreview, makeManageError, makeManageOutput, normalizeManageOperation } from "./manage-guidance.js";
import { LocalVaultManager, manageErrorFromUnknown, type VaultManager } from "./vault-manager.js";
import type { ObsidianManageError, ObsidianManageOutput, ObsidianManageRequest } from "./manage-types.js";

export interface ObsidianManageOptions {
  vaultRoot?: string | undefined;
  manager?: VaultManager | undefined;
}

export async function obsidianManage(request: ObsidianManageRequest, options: ObsidianManageOptions = {}): Promise<ObsidianManageOutput> {
  const dryRun = request.dryRun ?? true;
  const op = normalizeManageOperation(request.operation);
  const requestedOperation = op.requested ?? request.operation?.trim();

  if (!request.operation?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      dryRun,
      message: "obsidian_manage requires operation=move_note.",
      error: makeManageError("MISSING_OPERATION", "validation", "Provide operation=move_note."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeManageOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      message: "obsidian_manage supports only move_note; the requested operation was refused.",
      error: makeManageError(code, "safety", "Use only operation=move_note. Folder moves, overwrite, delete, copy, link rewrite, UI, shell, network, scan, discovery, and arbitrary command operations are not supported."),
      warnings: ["Forbidden or unsupported management operation refused; no note or folder was changed."],
    });
  }

  if (!request.fromPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      message: "obsidian_manage move_note requires an explicit source Markdown note path.",
      error: makeManageError("MISSING_FROM_PATH", "validation", "Provide an explicit safe vault-relative Markdown fromPath; obsidian_manage will not infer one."),
    });
  }

  if (!request.toPath?.trim()) {
    return makeManageOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      message: "obsidian_manage move_note requires an explicit destination Markdown note path.",
      error: makeManageError("MISSING_TO_PATH", "validation", "Provide an explicit safe vault-relative Markdown toPath; obsidian_manage will not infer one."),
    });
  }

  let manager: VaultManager;
  try {
    manager = options.manager ?? new LocalVaultManager(options.vaultRoot);
  } catch (error) {
    const mapped = manageErrorFromUnknown(error);
    return makeManageOutput({
      status: "setup_required",
      operation: op.operation,
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
      operation: op.operation,
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
      operation: op.operation,
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
      operation: op.operation,
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
        operation: op.operation,
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
      operation: op.operation,
      fromPath: safeFromPath,
      toPath: safeToPath,
      dryRun,
      committed: true,
      message: `obsidian_manage move_note committed from ${safeFromPath} to ${safeToPath}.`,
      target,
    });
  } catch (error) {
    return mapManageFailure(error, safeFromPath, safeToPath, dryRun);
  }
}

function mapManageFailure(error: unknown, fromPath: string, toPath: string, dryRun: boolean): ObsidianManageOutput {
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
    const code = mapped.code === "VAULT_NOT_WRITABLE" ? "VAULT_NOT_WRITABLE" : mapped.code === "VAULT_NOT_ACCESSIBLE" ? "VAULT_NOT_ACCESSIBLE" : "VAULT_PATH_REQUIRED";
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
