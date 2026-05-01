import type { ManagePreview, ManageTargetSummary, ObsidianManageError, ObsidianManageNextAction, ObsidianManageOperation, ObsidianManageOutput, ObsidianManageStatus } from "./manage-types.js";

const FORBIDDEN_OPERATIONS = new Set([
  "overwrite",
  "replace",
  "replace_exact_text",
  "replace_section",
  "insert_under_heading",
  "update_frontmatter",
  "remove_frontmatter",
  "truncate",
  "prepend",
  "delete",
  "remove",
  "copy",
  "duplicate",
  "restore",
  "rename",
  "move",
  "move_folder",
  "rename_folder",
  "delete_folder",
  "remove_folder",
  "create_folder",
  "mkdir",
  "create_directory",
  "open",
  "launch",
  "shell",
  "bash",
  "exec",
  "command",
  "curl",
  "fetch",
  "network",
  "scan",
  "search",
  "discover",
  "rewrite_links",
  "link_rewrite",
]);

export function normalizeManageOperation(value: string | undefined): { operation?: ObsidianManageOperation | undefined; requested?: string | undefined; forbidden: boolean } {
  const requested = value?.trim().toLowerCase();
  if (!requested) return { forbidden: false };
  if (requested === "move_note") return { operation: requested, requested, forbidden: false };
  const forbidden = FORBIDDEN_OPERATIONS.has(requested) || /overwrite|replace|truncate|prepend|delete|remove|copy|duplicate|restore|rename|\bmove\b|folder|open|launch|shell|bash|exec|command|curl|fetch|network|scan|discover|rewrite|link/.test(requested);
  return { requested, forbidden };
}

export function makeManageError(code: ObsidianManageError["code"], category: ObsidianManageError["category"], message: string, recoverable = true): ObsidianManageError {
  return { code, category, message, recoverable };
}

export function buildMovePreview(target: ManageTargetSummary): ManagePreview {
  return {
    operation: "move_note",
    fromPath: target.fromPath,
    toPath: target.toPath,
    targetKind: "markdown",
    wouldMove: true,
    wouldRename: target.renamedWithinFolder,
    wouldChangeParent: target.movedToDifferentFolder,
    wouldOverwrite: false,
    wouldRewriteLinks: false,
  };
}

export function makeManageOutput(input: {
  status: ObsidianManageStatus;
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  dryRun: boolean;
  committed?: boolean | undefined;
  message: string;
  target?: ManageTargetSummary | undefined;
  preview?: ManagePreview | undefined;
  error?: ObsidianManageError | undefined;
  warnings?: string[] | undefined;
  nextActions?: ObsidianManageNextAction[] | undefined;
}): ObsidianManageOutput {
  const output: ObsidianManageOutput = {
    tool: "obsidian_manage",
    status: input.status,
    dryRun: input.dryRun,
    committed: input.committed ?? false,
    message: input.message,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? nextActionsFor(input.status, input.fromPath, input.toPath, input.error),
  };
  if (input.operation) output.operation = input.operation;
  if (input.fromPath) output.fromPath = input.fromPath;
  if (input.toPath) output.toPath = input.toPath;
  if (input.target) output.target = input.target;
  if (input.preview) output.preview = input.preview;
  if (input.error) output.error = input.error;
  return output;
}

export function nextActionsFor(status: ObsidianManageStatus, fromPath: string | undefined, toPath: string | undefined, error: ObsidianManageError | undefined): ObsidianManageNextAction[] {
  switch (status) {
    case "preview": {
      const params: NonNullable<ObsidianManageNextAction["params"]> = { operation: "move_note", dryRun: false };
      if (fromPath) params.fromPath = fromPath;
      if (toPath) params.toPath = toPath;
      return [{ priority: 1, action: "confirm_preview", label: "Ask the user to confirm, then retry obsidian_manage with dryRun=false and the same explicit fromPath/toPath.", params }];
    }
    case "success":
      return [{ priority: 1, action: "answer_success", label: "Tell the user the note was moved or renamed and cite only the vault-relative source and destination paths." }];
    case "not_found":
      if (error?.code === "PARENT_MISSING") {
        return [
          { priority: 1, action: "create_parent_folder", label: "Create the missing destination parent folder explicitly before retrying move_note." },
          toPath ? { priority: 2, action: "retry_with_to_path", label: "Retry with a destination path whose parent folder already exists.", params: { operation: "move_note", fromPath, toPath, dryRun: true } } : { priority: 2, action: "retry_with_to_path", label: "Retry with a destination path whose parent folder already exists." },
        ];
      }
      return [fromPath ? { priority: 1, action: "retry_with_from_path", label: "Retry only after the user provides an existing source Markdown note path.", params: { operation: "move_note", fromPath, toPath, dryRun: true } } : { priority: 1, action: "retry_with_from_path", label: "Retry only after the user provides an existing source Markdown note path." }];
    case "conflict":
      return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit safe source/destination path; obsidian_manage will not overwrite, move folders, or replace parent files." }];
    case "setup_required":
      return [{ priority: 1, action: "configure_vault_path", label: "Configure a local readable and writable Obsidian vault path before retrying obsidian_manage." }];
    case "validation_error":
      return [{ priority: 1, action: "retry_with_from_path", label: "Retry with operation=move_note, distinct explicit safe vault-relative Markdown fromPath and toPath, and dryRun=true for preview." }];
    case "safety_refusal":
    case "manage_failed":
    default:
      return [{ priority: 1, action: "stop", label: "Do not retry this management request until the unsafe request or runtime problem is corrected." }];
  }
}
