import type { DestroyPreview, DestroyTargetSummary, ObsidianDestroyError, ObsidianDestroyNextAction, ObsidianDestroyOperation, ObsidianDestroyOutput, ObsidianDestroyStatus } from "./destroy-types.js";

const PREVIEW_CHARS = 1_000;

export function normalizeDestroyOperation(input: string | undefined): { operation?: ObsidianDestroyOperation | undefined; requested?: string | undefined; forbidden: boolean } {
  const requested = input?.trim();
  const normalized = requested?.toLowerCase();
  if (!normalized) return { requested, forbidden: false };
  if (normalized === "delete_note" || normalized === "delete_folder" || normalized === "replace_note" || normalized === "empty_trash") return { operation: normalized, requested, forbidden: false };
  const forbidden = /delete|destroy|remove|wipe|overwrite|replace|empty|purge|rm|unlink|rmdir/i.test(normalized);
  return { requested, forbidden };
}

export function makeDestroyError(code: ObsidianDestroyError["code"], category: ObsidianDestroyError["category"], message: string, recoverable = true): ObsidianDestroyError {
  return { code, category, message, recoverable };
}

export function makeDestroyOutput(input: {
  status: ObsidianDestroyStatus;
  operation?: string | undefined;
  path?: string | undefined;
  trashFolder?: string | undefined;
  dryRun: boolean;
  committed?: boolean | undefined;
  message: string;
  target?: DestroyTargetSummary | undefined;
  preview?: DestroyPreview | undefined;
  error?: ObsidianDestroyError | undefined;
  warnings?: string[] | undefined;
  nextActions?: ObsidianDestroyNextAction[] | undefined;
}): ObsidianDestroyOutput {
  const output: ObsidianDestroyOutput = {
    tool: "obsidian_destroy",
    status: input.status,
    dryRun: input.dryRun,
    committed: input.committed ?? false,
    message: input.message,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? nextActionsFor(input.status, input.operation, input.path),
  };
  if (input.operation) output.operation = input.operation;
  if (input.path) output.path = input.path;
  if (input.trashFolder) output.trashFolder = input.trashFolder;
  if (input.target) output.target = input.target;
  if (input.preview) output.preview = input.preview;
  if (input.error) output.error = input.error;
  return output;
}

export function buildDestroyPreview(operation: ObsidianDestroyOperation, target: DestroyTargetSummary, beforeContent: string | undefined, afterContent: string | undefined, maxPreviewChars = PREVIEW_CHARS): DestroyPreview {
  const limit = Math.max(1, Math.floor(maxPreviewChars));
  const preview: DestroyPreview = {
    operation,
    targetKind: target.targetKind,
    wouldDelete: operation === "delete_note" || operation === "delete_folder",
    wouldReplace: operation === "replace_note",
    wouldEmptyTrash: operation === "empty_trash",
    permanentlyDeletes: true,
  };
  if ("path" in target) preview.path = target.path;
  if ("trashFolder" in target) preview.trashFolder = target.trashFolder;
  if ("entryCount" in target) preview.entryCount = target.entryCount;
  if ("fileCount" in target) preview.fileCount = target.fileCount;
  if ("folderCount" in target) preview.folderCount = target.folderCount;
  if ("bytesBefore" in target && target.bytesBefore !== undefined) preview.bytesBefore = target.bytesBefore;
  if ("bytesAfter" in target && target.bytesAfter !== undefined) preview.bytesAfter = target.bytesAfter;
  if (beforeContent !== undefined) {
    preview.beforePreview = clipRaw(beforeContent, limit);
    if (preview.beforePreview.length < beforeContent.length) preview.previewTruncated = true;
  }
  if (afterContent !== undefined) {
    preview.afterPreview = clipRaw(afterContent, limit);
    if (preview.afterPreview.length < afterContent.length) preview.previewTruncated = true;
  }
  return preview;
}

export function nextActionsFor(status: ObsidianDestroyStatus, operation: string | undefined, path: string | undefined): ObsidianDestroyNextAction[] {
  const safeOperation = operation === "delete_note" || operation === "delete_folder" || operation === "replace_note" || operation === "empty_trash" ? operation : undefined;
  switch (status) {
    case "preview": {
      const params: NonNullable<ObsidianDestroyNextAction["params"]> = { dryRun: false };
      if (safeOperation) params.operation = safeOperation;
      if (path) params.path = path;
      return [{ priority: 1, action: "confirm_preview", label: "Ask the user to explicitly approve the destructive preview before permanently changing the vault.", params }];
    }
    case "success":
      return [{ priority: 1, action: "answer_success", label: "Tell the user the destructive operation completed and cite only vault-relative paths." }];
    case "setup_required":
      return [{ priority: 1, action: "configure_vault_path", label: "Ask for the Obsidian vault folder path, remember it, then retry obsidian_destroy." }];
    case "not_found":
      return [{ priority: 1, action: "retry_with_path", label: "Retry only after the user provides an existing explicit safe target path." }];
    case "validation_error":
      return [{ priority: 1, action: operation === "replace_note" ? "retry_with_content" : "retry_with_path", label: "Retry with a supported destructive operation and all required explicit fields." }];
    case "safety_refusal":
    case "conflict":
    case "destroy_failed":
      return [{ priority: 1, action: "stop", label: "No destructive vault changes were made." }];
  }
}

function clipRaw(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
