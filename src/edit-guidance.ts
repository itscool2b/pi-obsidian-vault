import type { EditPreview, EditTargetSummary, EditTransformResult, ObsidianEditError, ObsidianEditNextAction, ObsidianEditOperation, ObsidianEditOutput, ObsidianEditStatus } from "./edit-types.js";

const PREVIEW_CHARS = 500_000;
const FORBIDDEN_OPERATIONS = new Set(["overwrite", "replace", "replace_all", "regex_replace", "replace_regex", "fuzzy_replace", "semantic_replace", "inferred_replace", "truncate", "prepend", "delete", "remove", "unlink", "erase", "discard", "trash", "trash_note", "restore", "restore_note", "copy", "copy_note", "duplicate", "clone", "recycle", "rename", "move", "move_note", "open", "launch", "shell", "bash", "exec", "command", "curl", "fetch", "network", "scan", "search", "discover", "write", "create", "append", "create_folder"]);

export function normalizeEditOperation(value: string | undefined): { operation?: ObsidianEditOperation | undefined; requested?: string | undefined; forbidden: boolean } {
  const requested = value?.trim().toLowerCase();
  if (!requested) return { forbidden: false };
  if (requested === "replace_section" || requested === "insert_under_heading" || requested === "update_frontmatter" || requested === "remove_frontmatter" || requested === "replace_exact_text") return { operation: requested, requested, forbidden: false };
  const forbidden = FORBIDDEN_OPERATIONS.has(requested) || /overwrite|truncate|prepend|delete|remove|unlink|erase|discard|trash|restore|copy|duplicate|clone|recycle|rename|move|open|launch|shell|bash|exec|command|curl|fetch|network|scan|discover|regex|fuzzy|semantic|inferred|replace_all|\bwrite\b/.test(requested);
  return { requested, forbidden };
}

export function clipEditPreview(value: string, maxChars = PREVIEW_CHARS): { preview: string; truncated: boolean } {
  const clean = value.replace(/\s+$/g, "");
  if (clean.length <= maxChars) return { preview: clean, truncated: false };
  return { preview: `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`, truncated: true };
}

export function makeEditError(code: ObsidianEditError["code"], category: ObsidianEditError["category"], message: string, recoverable = true, details?: Record<string, unknown> | undefined): ObsidianEditError {
  const error: ObsidianEditError = { code, category, message, recoverable };
  if (details) error.details = details;
  return error;
}

export function buildEditPreview(operation: ObsidianEditOperation, path: string, transform: EditTransformResult, bytesAfter: number, maxPreviewChars = PREVIEW_CHARS): EditPreview {
  const limit = Math.max(1, Math.min(PREVIEW_CHARS, maxPreviewChars));
  const preview: EditPreview = {
    operation,
    path,
    targetKind: transform.targetKind,
    change: transform.change,
    expectedBytesAfter: bytesAfter,
  };
  if (transform.heading) preview.heading = transform.heading;
  if (transform.property) preview.property = transform.property;
  let truncatedByLimit = false;
  if (transform.beforePreview !== undefined) {
    const clipped = clipEditPreview(transform.beforePreview, limit);
    preview.beforePreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.afterPreview !== undefined) {
    const clipped = clipEditPreview(transform.afterPreview, limit);
    preview.afterPreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.insertedPreview !== undefined) {
    const clipped = clipEditPreview(transform.insertedPreview, limit);
    preview.insertedPreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.contentChars !== undefined) preview.contentChars = transform.contentChars;
  if (transform.valuePreview !== undefined) {
    const clipped = clipEditPreview(transform.valuePreview, limit);
    preview.valuePreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.valueType !== undefined) preview.valueType = transform.valueType;
  if (transform.oldTextPreview !== undefined) {
    const clipped = clipEditPreview(transform.oldTextPreview, limit);
    preview.oldTextPreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.newTextPreview !== undefined) {
    const clipped = clipEditPreview(transform.newTextPreview, limit);
    preview.newTextPreview = clipped.preview;
    truncatedByLimit ||= clipped.truncated;
  }
  if (transform.oldTextChars !== undefined) preview.oldTextChars = transform.oldTextChars;
  if (transform.newTextChars !== undefined) preview.newTextChars = transform.newTextChars;
  if (transform.changedChars !== undefined) preview.changedChars = transform.changedChars;
  if (transform.changedBytes !== undefined) preview.changedBytes = transform.changedBytes;
  if (transform.previewTruncated !== undefined || truncatedByLimit) preview.previewTruncated = Boolean(transform.previewTruncated || truncatedByLimit);
  if (transform.bodyPreserved !== undefined) preview.bodyPreserved = transform.bodyPreserved;
  return preview;
}

export function makeEditOutput(input: {
  status: ObsidianEditStatus;
  operation?: string | undefined;
  path?: string | undefined;
  dryRun: boolean;
  committed?: boolean | undefined;
  message: string;
  target?: EditTargetSummary | undefined;
  preview?: EditPreview | undefined;
  error?: ObsidianEditError | undefined;
  warnings?: string[] | undefined;
  nextActions?: ObsidianEditNextAction[] | undefined;
}): ObsidianEditOutput {
  const output: ObsidianEditOutput = {
    tool: "obsidian_edit",
    status: input.status,
    dryRun: input.dryRun,
    committed: input.committed ?? false,
    message: input.message,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? nextActionsFor(input.status, input.operation, input.path, input.target),
  };
  if (input.operation) output.operation = input.operation;
  if (input.path) output.path = input.path;
  if (input.target) output.target = input.target;
  if (input.preview) output.preview = input.preview;
  if (input.error) output.error = input.error;
  return output;
}

export function nextActionsFor(status: ObsidianEditStatus, operation: string | undefined, path: string | undefined, target: EditTargetSummary | undefined): ObsidianEditNextAction[] {
  const safeOperation = operation === "replace_section" || operation === "insert_under_heading" || operation === "update_frontmatter" || operation === "remove_frontmatter" || operation === "replace_exact_text" ? operation : undefined;
  switch (status) {
    case "preview": {
      const params: NonNullable<ObsidianEditNextAction["params"]> = { dryRun: false };
      if (safeOperation) params.operation = safeOperation;
      if (path) params.path = path;
      if (target?.heading) params.heading = `${"#".repeat(target.heading.level)} ${target.heading.text}`;
      if (target?.property) params.property = target.property.name;
      return [{ priority: 1, action: "confirm_preview", label: "Ask the user to approve the preview before editing the note.", params }];
    }
    case "success":
      return [{ priority: 1, action: "answer_success", label: "Tell the user the structured edit completed and cite the vault-relative note path." }];
    case "not_found":
      return [{ priority: 1, action: target?.heading ? "retry_with_heading" : target?.property ? "retry_with_property" : "retry_with_path", label: "Retry only after the user provides an existing note path and an exact existing heading, property, or oldText target." }];
    case "ambiguous":
      return [{ priority: 1, action: "ask_user_to_disambiguate", label: "Ask the user to choose a unique heading, property, or exact text target; do not select among duplicates automatically." }];
    case "setup_required":
      return [{ priority: 1, action: "configure_vault_path", label: "Ask for the Obsidian vault folder path, remember it, then retry obsidian_edit." }];
    case "validation_error":
      return [{ priority: 1, action: "retry_with_path", label: "Retry with a supported operation, explicit safe Markdown path, and required heading/content, property/value, or oldText/newText fields." }];
    case "safety_refusal":
    case "edit_failed":
    default:
      return [{ priority: 1, action: "stop", label: "Do not retry this edit until the unsafe request or runtime problem is corrected." }];
  }
}
