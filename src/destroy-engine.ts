import { buildDestroyPreview, makeDestroyError, makeDestroyOutput, normalizeDestroyOperation } from "./destroy-guidance.js";
import { LocalVaultDestroyer, destroyErrorFromUnknown, type VaultDestroyer } from "./vault-destroyer.js";
import type { ObsidianDestroyError, ObsidianDestroyOperation, ObsidianDestroyOutput, ObsidianDestroyRequest } from "./destroy-types.js";

export interface ObsidianDestroyOptions {
  vaultRoot?: string | undefined;
  destroyer?: VaultDestroyer | undefined;
  maxPreviewChars?: number | undefined;
  defaultTrashFolder?: string | undefined;
}

const DEFAULT_TRASH_FOLDER = "_Trash";

export async function obsidianDestroy(request: ObsidianDestroyRequest, options: ObsidianDestroyOptions = {}): Promise<ObsidianDestroyOutput> {
  const dryRun = request.dryRun ?? true;
  const op = normalizeDestroyOperation(request.operation);
  const requestedOperation = op.requested ?? request.operation?.trim();

  if (!request.operation?.trim()) {
    return makeDestroyOutput({
      status: "validation_error",
      dryRun,
      message: "obsidian_destroy requires operation=delete_note, delete_folder, replace_note, or empty_trash.",
      error: makeDestroyError("MISSING_OPERATION", "validation", "Provide one explicit destructive operation."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeDestroyOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      message: "obsidian_destroy supports only explicit delete_note, delete_folder, replace_note, and empty_trash operations; the requested operation was refused.",
      error: makeDestroyError(code, "safety", "Use only operation=delete_note, delete_folder, replace_note, or empty_trash. Broad, wildcard, inferred, shell, network, and arbitrary command operations are not supported."),
      warnings: ["Unsupported destructive operation refused; no vault content was changed."],
    });
  }

  const fieldError = validateDestroyFields(op.operation, request);
  if (fieldError) {
    return makeDestroyOutput({ status: "validation_error", operation: op.operation, dryRun, message: fieldError.message, error: fieldError });
  }

  let destroyer: VaultDestroyer;
  try {
    destroyer = options.destroyer ?? new LocalVaultDestroyer(options.vaultRoot);
  } catch (error) {
    const mapped = destroyErrorFromUnknown(error);
    return makeDestroyOutput({
      status: "setup_required",
      operation: op.operation,
      dryRun,
      message: "A local Obsidian vault path is required before obsidian_destroy can run.",
      error: makeDestroyError("VAULT_PATH_REQUIRED", "setup", "Open Obsidian once for auto-detection, or tell me your Obsidian vault folder path and I can remember it before destroying content."),
      warnings: [mapped.message],
    });
  }

  try {
    switch (op.operation) {
      case "delete_note":
        return await destroyDeleteNote(request.path!, dryRun, destroyer, options.maxPreviewChars);
      case "delete_folder":
        return await destroyDeleteFolder(request.path!, dryRun, destroyer);
      case "replace_note":
        return await destroyReplaceNote(request.path!, request.content!, dryRun, destroyer, options.maxPreviewChars);
      case "empty_trash":
        return await destroyEmptyTrash(dryRun, destroyer, options.defaultTrashFolder ?? DEFAULT_TRASH_FOLDER);
    }
  } catch (error) {
    return mapDestroyFailure(error, op.operation, request.path, dryRun);
  }
}

async function destroyDeleteNote(path: string, dryRun: boolean, destroyer: VaultDestroyer, maxPreviewChars: number | undefined): Promise<ObsidianDestroyOutput> {
  if (dryRun) {
    const { target, content } = await destroyer.previewDeleteNote(path);
    return makeDestroyOutput({
      status: "preview",
      operation: "delete_note",
      path: target.path,
      dryRun,
      committed: false,
      message: `Dry-run preview: obsidian_destroy would permanently delete note ${target.path}.`,
      target,
      preview: buildDestroyPreview("delete_note", target, content, undefined, maxPreviewChars),
      warnings: ["This operation permanently deletes a Markdown note and is not recoverable by obsidian_manage restore_note."],
    });
  }
  const target = await destroyer.commitDeleteNote(path);
  return makeDestroyOutput({
    status: "success",
    operation: "delete_note",
    path: target.path,
    dryRun,
    committed: true,
    message: `obsidian_destroy delete_note permanently deleted ${target.path}.`,
    target,
  });
}

async function destroyDeleteFolder(path: string, dryRun: boolean, destroyer: VaultDestroyer): Promise<ObsidianDestroyOutput> {
  if (dryRun) {
    const target = await destroyer.previewDeleteFolder(path);
    return makeDestroyOutput({
      status: "preview",
      operation: "delete_folder",
      path: target.path,
      dryRun,
      committed: false,
      message: `Dry-run preview: obsidian_destroy would permanently delete folder ${target.path} and ${target.entryCount} contained entries.`,
      target,
      preview: buildDestroyPreview("delete_folder", target, undefined, undefined),
      warnings: ["This operation recursively and permanently deletes the explicit folder contents."],
    });
  }
  const target = await destroyer.commitDeleteFolder(path);
  return makeDestroyOutput({
    status: "success",
    operation: "delete_folder",
    path: target.path,
    dryRun,
    committed: true,
    message: `obsidian_destroy delete_folder permanently deleted ${target.path}.`,
    target,
  });
}

async function destroyReplaceNote(path: string, content: string, dryRun: boolean, destroyer: VaultDestroyer, maxPreviewChars: number | undefined): Promise<ObsidianDestroyOutput> {
  if (dryRun) {
    const { target, contentBefore } = await destroyer.previewReplaceNote(path, content);
    return makeDestroyOutput({
      status: "preview",
      operation: "replace_note",
      path: target.path,
      dryRun,
      committed: false,
      message: `Dry-run preview: obsidian_destroy would replace the entire contents of ${target.path}.`,
      target,
      preview: buildDestroyPreview("replace_note", target, contentBefore, content, maxPreviewChars),
      warnings: ["This operation overwrites the entire existing note content."],
    });
  }
  const target = await destroyer.commitReplaceNote(path, content);
  return makeDestroyOutput({
    status: "success",
    operation: "replace_note",
    path: target.path,
    dryRun,
    committed: true,
    message: `obsidian_destroy replace_note overwrote ${target.path}.`,
    target,
  });
}

async function destroyEmptyTrash(dryRun: boolean, destroyer: VaultDestroyer, trashFolder: string): Promise<ObsidianDestroyOutput> {
  if (dryRun) {
    const target = await destroyer.previewEmptyTrash(trashFolder);
    return makeDestroyOutput({
      status: "preview",
      operation: "empty_trash",
      trashFolder: target.trashFolder,
      dryRun,
      committed: false,
      message: `Dry-run preview: obsidian_destroy would permanently empty ${target.trashFolder} (${target.entryCount} entries).`,
      target,
      preview: buildDestroyPreview("empty_trash", target, undefined, undefined),
      warnings: ["This operation permanently deletes every entry currently inside the trash folder."],
    });
  }
  const target = await destroyer.commitEmptyTrash(trashFolder);
  return makeDestroyOutput({
    status: "success",
    operation: "empty_trash",
    trashFolder: target.trashFolder,
    dryRun,
    committed: true,
    message: `obsidian_destroy empty_trash permanently emptied ${target.trashFolder}.`,
    target,
  });
}

function validateDestroyFields(operation: ObsidianDestroyOperation, request: ObsidianDestroyRequest): ObsidianDestroyError | undefined {
  if (operation === "empty_trash") {
    if (request.path !== undefined || request.content !== undefined) return makeDestroyError("CONTENT_NOT_ALLOWED", "validation", "empty_trash accepts only operation and optional dryRun; path/content are not used.");
    return undefined;
  }
  if (!request.path?.trim()) return makeDestroyError("MISSING_PATH", "validation", `${operation} requires an explicit safe vault-relative path.`);
  if (operation === "replace_note") {
    if (request.content === undefined) return makeDestroyError("MISSING_CONTENT", "validation", "replace_note requires full replacement Markdown content.");
    if (request.content.trim() === "") return makeDestroyError("EMPTY_CONTENT", "validation", "replace_note content must not be empty.");
    return undefined;
  }
  if (request.content !== undefined) return makeDestroyError("CONTENT_NOT_ALLOWED", "validation", `${operation} does not accept content.`);
  return undefined;
}

function mapDestroyFailure(error: unknown, operation: ObsidianDestroyOperation, path: string | undefined, dryRun: boolean): ObsidianDestroyOutput {
  const mapped = destroyErrorFromUnknown(error);
  const status = mapped.category === "setup"
    ? "setup_required"
    : mapped.category === "safety"
      ? "safety_refusal"
      : mapped.category === "validation"
        ? "validation_error"
        : mapped.category === "not_found"
          ? "not_found"
          : mapped.category === "conflict"
            ? "conflict"
            : "destroy_failed";
  return makeDestroyOutput({
    status,
    operation,
    path,
    dryRun,
    committed: false,
    message: mapped.category === "safety" ? "The destructive target is not safe for obsidian_destroy." : mapped.message,
    error: makeDestroyError(mapped.code as ObsidianDestroyError["code"], mapped.category, mapped.message),
    warnings: ["No destructive vault change was completed."],
  });
}
