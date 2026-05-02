import type { CopyPreview, CopyTargetSummary, ManageLinkImpact, ManagePreview, ManageTargetSummary, ObsidianManageError, ObsidianManageNextAction, ObsidianManageOperation, ObsidianManageOutput, ObsidianManageStatus, RestorePreview, RestoreTargetSummary, TrashPreview, TrashTargetSummary } from "./manage-types.js";
import type { DegradedSignal } from "./retrieval-types.js";

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
  "delete_note",
  "remove",
  "remove_note",
  "unlink",
  "erase",
  "discard",
  "trash",
  "recycle",
  "empty_trash",
  "copy",
  "duplicate",
  "clone",
  "duplicate_note",
  "restore",
  "untrash",
  "recover",
  "undo",
  "rename",
  "move",
  "move_folder",
  "rename_folder",
  "delete_folder",
  "remove_folder",
  "trash_folder",
  "recursive_delete",
  "bulk_delete",
  "wildcard_delete",
  "recursive_restore",
  "bulk_restore",
  "wildcard_restore",
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
  if (requested === "move_note" || requested === "trash_note" || requested === "restore_note" || requested === "copy_note") return { operation: requested, requested, forbidden: false };
  const forbidden = FORBIDDEN_OPERATIONS.has(requested) || /overwrite|replace|truncate|prepend|delete|remove|unlink|erase|discard|trash|recycle|copy|duplicate|clone|restore|rename|\bmove\b|folder|recursive|bulk|wildcard|open|launch|shell|bash|exec|command|curl|fetch|network|scan|discover|rewrite|link/.test(requested);
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

export function buildTrashPreview(target: TrashTargetSummary): TrashPreview {
  return {
    operation: "trash_note",
    path: target.path,
    trashFolder: target.trashFolder,
    trashPath: target.trashPath,
    targetKind: "markdown",
    wouldTrash: true,
    wouldCreateTrashFolder: target.trashFolderWouldBeCreated,
    wouldOverwrite: false,
    wouldPermanentlyDelete: false,
    wouldRewriteLinks: false,
  };
}

export function buildRestorePreview(target: RestoreTargetSummary): RestorePreview {
  return {
    operation: "restore_note",
    trashPath: target.trashPath,
    toPath: target.toPath,
    trashFolder: target.trashFolder,
    targetKind: "markdown",
    wouldRestore: true,
    wouldOverwrite: false,
    wouldCreateParent: false,
    wouldPermanentlyDelete: false,
    wouldRewriteLinks: false,
  };
}

export function buildCopyPreview(target: CopyTargetSummary): CopyPreview {
  return {
    operation: "copy_note",
    fromPath: target.fromPath,
    toPath: target.toPath,
    targetKind: "markdown",
    wouldCopy: true,
    wouldOverwrite: false,
    wouldCreateParent: false,
    wouldMoveSource: false,
    wouldDeleteSource: false,
    wouldRewriteLinks: false,
  };
}

export function buildLinkImpact(input: {
  operation: ObsidianManageOperation;
  sourcePath: string;
  outgoingWikiLinkCount: number;
  outgoingMarkdownLinkCount: number;
  degradedSignals?: DegradedSignal[] | undefined;
}): ManageLinkImpact {
  const hasOutgoingLinks = input.outgoingWikiLinkCount > 0 || input.outgoingMarkdownLinkCount > 0;
  const degradedSignals = [...new Set(input.degradedSignals ?? [])].sort();
  const warning = linkImpactWarning(input.operation, hasOutgoingLinks, degradedSignals.length > 0);
  const impact: ManageLinkImpact = {
    sourcePath: input.sourcePath,
    outgoingWikiLinkCount: input.outgoingWikiLinkCount,
    outgoingMarkdownLinkCount: input.outgoingMarkdownLinkCount,
    hasOutgoingLinks,
    linkImpactWarning: warning,
    linkRewriteSupported: false,
  };
  if (degradedSignals.length > 0) impact.degradedSignals = degradedSignals;
  return impact;
}

export function linkImpactWarning(operation: ObsidianManageOperation, hasOutgoingLinks: boolean, inboundDegraded: boolean): string {
  const operationLabel = operation.replace("_note", "");
  const outgoing = hasOutgoingLinks ? "Outgoing links were detected" : "No outgoing links were detected";
  if (operation === "copy_note") return `This copy preview does not rewrite links. ${outgoing}; copied content will preserve link targets exactly.`;
  if (operation === "restore_note") return `This restore preview does not rewrite links. ${outgoing}; backlink and relationship data is not scanned broadly.`;
  const inbound = inboundDegraded ? " and inbound links may be affected because backlink data is unavailable without a broad scan" : "";
  return `This ${operationLabel} preview does not rewrite links. ${outgoing}${inbound}.`;
}

export function makeManageOutput(input: {
  status: ObsidianManageOutput["status"];
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  path?: string | undefined;
  trashFolder?: string | undefined;
  trashPath?: string | undefined;
  dryRun: boolean;
  committed?: boolean | undefined;
  message: string;
  target?: ManageTargetSummary | TrashTargetSummary | RestoreTargetSummary | CopyTargetSummary | undefined;
  preview?: ManagePreview | TrashPreview | RestorePreview | CopyPreview | undefined;
  linkImpact?: ManageLinkImpact | undefined;
  degradedSignals?: string[] | undefined;
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
    nextActions: input.nextActions ?? nextActionsFor({
      status: input.status,
      operation: input.operation,
      fromPath: input.fromPath,
      toPath: input.toPath,
      path: input.path,
      trashFolder: input.trashFolder,
      trashPath: input.trashPath,
      error: input.error,
    }),
  };
  if (input.operation) output.operation = input.operation;
  if (input.fromPath) output.fromPath = input.fromPath;
  if (input.toPath) output.toPath = input.toPath;
  if (input.path) output.path = input.path;
  if (input.trashFolder) output.trashFolder = input.trashFolder;
  if (input.trashPath) output.trashPath = input.trashPath;
  if (input.target) output.target = input.target;
  if (input.preview) output.preview = input.preview;
  if (input.linkImpact) output.linkImpact = input.linkImpact;
  if (input.degradedSignals && input.degradedSignals.length > 0) output.degradedSignals = [...new Set(input.degradedSignals)].sort();
  if (input.error) output.error = input.error;
  return output;
}

export function nextActionsFor(input: {
  status: ObsidianManageStatus;
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  path?: string | undefined;
  trashFolder?: string | undefined;
  trashPath?: string | undefined;
  error?: ObsidianManageError | undefined;
}): ObsidianManageNextAction[] {
  const { status, operation, fromPath, toPath, path, trashFolder, trashPath, error } = input;
  switch (status) {
    case "preview": {
      if (operation === "trash_note") {
        const params: NonNullable<ObsidianManageNextAction["params"]> = { operation: "trash_note", dryRun: false };
        if (path) params.path = path;
        if (trashFolder) params.trashFolder = trashFolder;
        return [{ priority: 1, action: "confirm_preview", label: "Ask the user to confirm, then retry obsidian_manage with dryRun=false and the same explicit path/trashFolder.", params }];
      }
      if (operation === "restore_note") {
        const params: NonNullable<ObsidianManageNextAction["params"]> = { operation: "restore_note", dryRun: false };
        if (trashPath) params.trashPath = trashPath;
        if (toPath) params.toPath = toPath;
        if (trashFolder) params.trashFolder = trashFolder;
        return [{ priority: 1, action: "confirm_preview", label: "Ask the user to confirm, then retry obsidian_manage with dryRun=false and the same explicit trashPath/toPath/trashFolder.", params }];
      }
      if (operation === "copy_note") {
        const params: NonNullable<ObsidianManageNextAction["params"]> = { operation: "copy_note", dryRun: false };
        if (fromPath) params.fromPath = fromPath;
        if (toPath) params.toPath = toPath;
        return [{ priority: 1, action: "confirm_preview", label: "Ask the user to confirm, then retry obsidian_manage with dryRun=false and the same explicit fromPath/toPath.", params }];
      }
      const params: NonNullable<ObsidianManageNextAction["params"]> = { operation: "move_note", dryRun: false };
      if (fromPath) params.fromPath = fromPath;
      if (toPath) params.toPath = toPath;
      return [{ priority: 1, action: "confirm_preview", label: "Ask the user to confirm, then retry obsidian_manage with dryRun=false and the same explicit fromPath/toPath.", params }];
    }
    case "success":
      return [{ priority: 1, action: "answer_success", label: operation === "trash_note" ? "Tell the user the note was moved to trash and cite only vault-relative source and trash paths." : operation === "restore_note" ? "Tell the user the note was restored and cite only vault-relative trash source and destination paths." : operation === "copy_note" ? "Tell the user the note was copied and cite only the vault-relative source and destination paths." : "Tell the user the note was moved or renamed and cite only the vault-relative source and destination paths." }];
    case "not_found":
      if (error?.code === "PARENT_MISSING") {
        if (operation === "restore_note") {
          return [
            { priority: 1, action: "create_parent_folder", label: "Ask the user whether to create the missing destination parent folder explicitly with obsidian_write create_folder before retrying restore_note." },
            toPath ? { priority: 2, action: "retry_with_to_path", label: "Retry restore_note with a destination path whose parent folder already exists.", params: { operation: "restore_note", trashPath, toPath, trashFolder, dryRun: true } } : { priority: 2, action: "retry_with_to_path", label: "Retry restore_note with a destination path whose parent folder already exists." },
          ];
        }
        if (operation === "copy_note") {
          return [
            { priority: 1, action: "create_parent_folder", label: "Ask the user whether to create the missing destination parent folder explicitly with obsidian_write create_folder before retrying copy_note." },
            toPath ? { priority: 2, action: "retry_with_to_path", label: "Retry copy_note with a destination path whose parent folder already exists.", params: { operation: "copy_note", fromPath, toPath, dryRun: true } } : { priority: 2, action: "retry_with_to_path", label: "Retry copy_note with a destination path whose parent folder already exists." },
          ];
        }
        return [
          { priority: 1, action: "create_parent_folder", label: "Create the missing destination parent folder explicitly before retrying move_note." },
          toPath ? { priority: 2, action: "retry_with_to_path", label: "Retry with a destination path whose parent folder already exists.", params: { operation: "move_note", fromPath, toPath, dryRun: true } } : { priority: 2, action: "retry_with_to_path", label: "Retry with a destination path whose parent folder already exists." },
        ];
      }
      if (operation === "restore_note") {
        return [trashPath ? { priority: 1, action: "retry_with_trash_path", label: "Retry only after the user provides an existing trashed Markdown note path inside the selected trashFolder.", params: { operation: "restore_note", trashPath, toPath, trashFolder, dryRun: true } } : { priority: 1, action: "retry_with_trash_path", label: "Retry only after the user provides an existing trashed Markdown note path inside the selected trashFolder." }];
      }
      if (operation === "trash_note") {
        return [path ? { priority: 1, action: "retry_with_path", label: "Retry only after the user provides an existing source Markdown note path to trash.", params: { operation: "trash_note", path, trashFolder, dryRun: true } } : { priority: 1, action: "retry_with_path", label: "Retry only after the user provides an existing source Markdown note path to trash." }];
      }
      if (operation === "copy_note") {
        return [fromPath ? { priority: 1, action: "retry_with_from_path", label: "Retry copy_note only after the user provides an existing source Markdown note path.", params: { operation: "copy_note", fromPath, toPath, dryRun: true } } : { priority: 1, action: "retry_with_from_path", label: "Retry copy_note only after the user provides an existing source Markdown note path." }];
      }
      return [fromPath ? { priority: 1, action: "retry_with_from_path", label: "Retry only after the user provides an existing source Markdown note path.", params: { operation: "move_note", fromPath, toPath, dryRun: true } } : { priority: 1, action: "retry_with_from_path", label: "Retry only after the user provides an existing source Markdown note path." }];
    case "conflict":
      if (operation === "trash_note") {
        if (error?.code === "TRASH_FOLDER_NOT_FOLDER") return [{ priority: 1, action: "retry_with_trash_folder", label: "Choose a different explicit safe trashFolder or remove the non-folder blocker outside this tool before retrying." }];
        return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit source note or safe trashFolder; obsidian_manage trash_note will not overwrite, suffix, auto-rename, or search for another trash target." }];
      }
      if (operation === "restore_note") {
        if (error?.code === "PARENT_NOT_FOLDER") return [{ priority: 1, action: "retry_with_to_path", label: "Choose a destination path whose parent is an existing folder; restore_note will not replace parent files." }];
        if (error?.code === "TRASH_FOLDER_NOT_FOLDER") return [{ priority: 1, action: "retry_with_trash_folder", label: "Choose a different explicit safe trashFolder or remove the non-folder blocker outside this tool before retrying restore_note." }];
        return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit destination path; obsidian_manage restore_note will not overwrite, suffix, auto-rename, or search for another target." }];
      }
      if (operation === "copy_note") {
        if (error?.code === "PARENT_NOT_FOLDER") return [{ priority: 1, action: "retry_with_to_path", label: "Choose a destination path whose parent is an existing folder; copy_note will not replace parent files." }];
        return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit destination path; obsidian_manage copy_note will not overwrite, suffix, auto-rename, or search for another target." }];
      }
      return [{ priority: 1, action: "choose_different_path", label: "Choose a different explicit safe source/destination path; obsidian_manage will not overwrite, move folders, or replace parent files." }];
    case "setup_required":
      return [{ priority: 1, action: "configure_vault_path", label: "Configure a local readable and writable Obsidian vault path before retrying obsidian_manage." }];
    case "validation_error":
      if (operation === "trash_note" || error?.code === "MISSING_PATH") {
        return [{ priority: 1, action: "retry_with_path", label: "Retry with operation=trash_note, one explicit safe vault-relative Markdown path, optional safe trashFolder, and dryRun=true for preview." }];
      }
      if (operation === "restore_note" || error?.code === "MISSING_TRASH_PATH") {
        return [{ priority: 1, action: "retry_with_trash_path", label: "Retry with operation=restore_note, explicit safe vault-relative Markdown trashPath inside trashFolder, explicit safe Markdown toPath, optional safe trashFolder, and dryRun=true for preview." }];
      }
      if (operation === "copy_note") {
        return [{ priority: 1, action: "retry_with_from_path", label: "Retry with operation=copy_note, distinct explicit safe vault-relative Markdown fromPath and toPath, and dryRun=true for preview." }];
      }
      if (error?.code === "SOURCE_NOT_MARKDOWN") {
        return [{ priority: 1, action: "retry_with_path", label: "Retry with operation=trash_note, one explicit safe vault-relative Markdown path, optional safe trashFolder, and dryRun=true for preview." }];
      }
      return [{ priority: 1, action: "retry_with_from_path", label: "Retry with operation=move_note, distinct explicit safe vault-relative Markdown fromPath and toPath, and dryRun=true for preview." }];
    case "safety_refusal":
      if (operation === "trash_note") return [{ priority: 1, action: "stop", label: "Do not retry this trash request until the unsafe source path, trashFolder, or forbidden operation is corrected." }];
      if (operation === "restore_note") return [{ priority: 1, action: "stop", label: "Do not retry this restore request until the unsafe trashPath, toPath, trashFolder, or forbidden operation is corrected." }];
      if (operation === "copy_note") return [{ priority: 1, action: "stop", label: "Do not retry this copy request until the unsafe fromPath, toPath, or forbidden operation is corrected." }];
      return [{ priority: 1, action: "stop", label: "Do not retry this management request until the unsafe request or runtime problem is corrected." }];
    case "manage_failed":
    default:
      return [{ priority: 1, action: "stop", label: "Do not retry this management request until the unsafe request or runtime problem is corrected." }];
  }
}
