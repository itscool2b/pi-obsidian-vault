import type { ValidationMetadata } from "./validation-types.js";
import type { ObsidianWriteError, ObsidianWriteNextAction, ObsidianWriteOperation, ObsidianWriteOutput, ObsidianWriteStatus, WriteContentSummary, WritePreview, WriteTargetSummary } from "./write-types.js";

const PREVIEW_CHARS = 500_000;
const FORBIDDEN_OPERATIONS = new Set(["overwrite", "replace", "truncate", "prepend", "delete", "remove", "unlink", "erase", "discard", "trash", "trash_note", "restore", "restore_note", "copy", "copy_note", "duplicate", "clone", "recycle", "rename", "move", "move_note", "open", "launch", "shell", "bash", "exec", "command", "curl", "fetch", "network", "scan", "search", "discover", "delete_folder", "remove_folder", "trash_folder", "restore_folder", "copy_folder", "rename_folder", "move_folder", "rmdir"]);

export function normalizeOperation(value: string | undefined): { operation?: ObsidianWriteOperation | undefined; requested?: string | undefined; forbidden: boolean } {
  const requested = value?.trim().toLowerCase();
  if (!requested) return { forbidden: false };
  if (requested === "create" || requested === "append" || requested === "create_folder") return { operation: requested, requested, forbidden: false };
  const forbidden = FORBIDDEN_OPERATIONS.has(requested) || /overwrite|replace|truncate|prepend|delete|remove|unlink|erase|discard|trash|restore|copy|duplicate|clone|recycle|rename|move|open|launch|shell|bash|exec|command|curl|fetch|network|scan|discover|rmdir/.test(requested);
  return { requested, forbidden };
}

export function contentSummary(raw: string, maxPreviewChars = PREVIEW_CHARS): { raw: string; chars: number; bytes: number; preview: string; previewTruncated: boolean } {
  const limit = Math.max(1, Math.min(PREVIEW_CHARS, maxPreviewChars));
  const preview = clip(raw, limit);
  return {
    raw,
    chars: raw.length,
    bytes: Buffer.byteLength(raw, "utf8"),
    preview,
    previewTruncated: preview.length < raw.replace(/\s+$/g, "").length,
  };
}

export function clip(value: string, maxChars: number): string {
  const clean = value.replace(/\s+$/g, "");
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function buildPreview(operation: ObsidianWriteOperation, path: string, content: WriteContentSummary | undefined, target: WriteTargetSummary): WritePreview {
  if (operation === "create_folder") {
    return {
      operation,
      path,
      targetKind: "folder",
      wouldCreate: true,
      wouldAppend: false,
      wouldCreateFolder: true,
      wouldCreateParentDirectories: !target.parentExistsBefore,
      alreadyExists: target.folderExistsBefore ?? target.existsBefore,
    };
  }

  if (!content) throw new Error("Markdown content is required to build create/append previews.");
  const preview: WritePreview = {
    operation,
    path,
    targetKind: "markdown",
    wouldCreate: operation === "create",
    wouldAppend: operation === "append",
    contentPreview: content.preview,
    contentChars: content.chars,
    previewTruncated: content.previewTruncated,
  };
  if (operation === "create") preview.wouldCreateParentDirectories = !target.parentExistsBefore;
  if (target.bytesAfter !== undefined) preview.expectedBytesAfter = target.bytesAfter;
  return preview;
}

export function makeError(code: ObsidianWriteError["code"], category: ObsidianWriteError["category"], message: string, recoverable = true): ObsidianWriteError {
  return { code, category, message, recoverable };
}

export function makeOutput(input: {
  status: ObsidianWriteStatus;
  operation?: string | undefined;
  path?: string | undefined;
  dryRun: boolean;
  committed?: boolean | undefined;
  message: string;
  target?: WriteTargetSummary | undefined;
  preview?: WritePreview | undefined;
  validation?: ValidationMetadata | undefined;
  error?: ObsidianWriteError | undefined;
  warnings?: string[] | undefined;
  nextActions?: ObsidianWriteNextAction[] | undefined;
}): ObsidianWriteOutput {
  const output: ObsidianWriteOutput = {
    tool: "obsidian_write",
    status: input.status,
    dryRun: input.dryRun,
    committed: input.committed ?? false,
    message: input.message,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? nextActionsFor(input.status, input.operation, input.path),
  };
  if (input.operation) output.operation = input.operation;
  if (input.path) output.path = input.path;
  if (input.target) output.target = input.target;
  if (input.preview) output.preview = input.preview;
  if (input.validation) output.validation = input.validation;
  if (input.error) output.error = input.error;
  return output;
}

export function nextActionsFor(status: ObsidianWriteStatus, operation: string | undefined, path: string | undefined): ObsidianWriteNextAction[] {
  const safeOperation = operation === "create" || operation === "append" || operation === "create_folder" ? operation : undefined;
  switch (status) {
    case "preview": {
      const params: NonNullable<ObsidianWriteNextAction["params"]> = { dryRun: false };
      if (safeOperation) params.operation = safeOperation;
      if (path) params.path = path;
      const label = safeOperation === "create_folder"
        ? "Ask the user to approve the preview before creating the folder."
        : "Ask the user to approve the preview before changing the note.";
      return [{ priority: 1, action: "confirm_preview", label, params }];
    }
    case "success":
      return [{ priority: 1, action: "answer_success", label: operation === "create_folder" ? "Tell the user the folder was created and cite the vault-relative folder path." : "Tell the user the write completed and cite the vault-relative note path." }];
    case "conflict":
      if (operation === "create_folder") {
        return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit safe folder path or stop if the existing folder is acceptable." }];
      }
      return [
        { priority: 1, action: "choose_different_path", label: "Choose a different explicit Markdown path before creating a new note." },
        path ? { priority: 2, action: "retry_with_append", label: "Use append only if the user intends to add to the existing note.", params: { operation: "append", path, dryRun: true } } : { priority: 2, action: "retry_with_append", label: "Use append only if the user intends to add to an existing note." },
      ];
    case "missing_target":
      return [path ? { priority: 1, action: "retry_with_create", label: "Use create mode if the user intends to create this missing note.", params: { operation: "create", path, dryRun: true } } : { priority: 1, action: "retry_with_create", label: "Use create mode with an explicit Markdown path if the user intends to create a note." }];
    case "setup_required":
      return [{ priority: 1, action: "configure_vault_path", label: "Configure a local Obsidian vault path before retrying obsidian_write." }];
    case "validation_error":
      return [{ priority: 1, action: "retry_with_path", label: "Retry with operation=create or append plus non-empty content, or operation=create_folder without content, using an explicit safe path and dryRun=true for preview." }];
    case "safety_refusal":
    case "write_failed":
    default:
      return [{ priority: 1, action: "stop", label: "Do not retry this write until the unsafe request or runtime problem is corrected." }];
  }
}
