import { buildEditPreview, makeEditError, makeEditOutput, normalizeEditOperation } from "./edit-guidance.js";
import { ExactTextEditError, planExactTextTransform } from "./exact-text-editor.js";
import { FrontmatterEditError, planRemoveFrontmatter, planUpdateFrontmatter } from "./frontmatter-editor.js";
import { MarkdownSectionEditError, planSectionTransform } from "./markdown-section-editor.js";
import { editErrorFromUnknown, LocalVaultEditor } from "./vault-editor.js";
import type { EditTransformResult, ObsidianEditError, ObsidianEditOperation, ObsidianEditOutput, ObsidianEditRequest } from "./edit-types.js";

export interface ObsidianEditOptions {
  vaultRoot?: string | undefined;
  editor?: LocalVaultEditor | undefined;
  maxPreviewChars?: number | undefined;
}

export async function obsidianEdit(request: ObsidianEditRequest, options: ObsidianEditOptions = {}): Promise<ObsidianEditOutput> {
  const dryRun = request.dryRun ?? true;
  const op = normalizeEditOperation(request.operation);
  const requestedOperation = op.requested ?? request.operation?.trim();

  if (!request.operation?.trim()) {
    return makeEditOutput({
      status: "validation_error",
      dryRun,
      message: "obsidian_edit requires an explicit supported operation.",
      error: makeEditError("MISSING_OPERATION", "validation", "Provide operation=replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, or replace_exact_text."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeEditOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      message: "obsidian_edit supports only controlled section, frontmatter, and exact-text operations; the requested operation was refused.",
      error: makeEditError(code, "safety", "Use only replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, or replace_exact_text. Full-note overwrite, delete, rename, move, UI, shell, network, regex, fuzzy, scan, and arbitrary command operations are not supported."),
      warnings: ["Forbidden or unsupported edit operation refused; no note was changed."],
    });
  }

  if (!request.path?.trim()) {
    return makeEditOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      message: "obsidian_edit requires an explicit vault-relative Markdown path.",
      error: makeEditError("MISSING_PATH", "validation", "Provide an explicit safe vault-relative Markdown path to an existing note; obsidian_edit will not infer one."),
    });
  }

  const fieldError = validateOperationFields(op.operation, request);
  if (fieldError) {
    return makeEditOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      message: fieldError.message,
      error: fieldError,
    });
  }

  let editor: LocalVaultEditor;
  try {
    editor = options.editor ?? new LocalVaultEditor(options.vaultRoot);
  } catch (error) {
    const mapped = editErrorFromUnknown(error);
    return setupRequired(op.operation, dryRun, mapped.message);
  }

  let safePath: string;
  try {
    safePath = editor.normalizePath(request.path);
  } catch (error) {
    const mapped = editErrorFromUnknown(error);
    return makeEditOutput({
      status: "safety_refusal",
      operation: op.operation,
      dryRun,
      message: "The target path is not safe for obsidian_edit.",
      error: makeEditError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe path refused; no note was changed."],
    });
  }

  const transform = (content: string): EditTransformResult => buildTransform(op.operation!, request, content);
  try {
    if (dryRun) {
      const result = await editor.preview(safePath, transform);
      const preview = buildEditPreview(op.operation, safePath, result.transform, result.target.bytesAfter ?? Buffer.byteLength(result.transform.contentAfter, "utf8"), options.maxPreviewChars);
      return makeEditOutput({
        status: "preview",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_edit would ${op.operation} ${safePath}.`,
        target: result.target,
        preview,
      });
    }


    const result = await editor.commit(safePath, transform);
    const preview = op.operation === "replace_exact_text"
      ? buildEditPreview(op.operation, safePath, result.transform, result.target.bytesAfter ?? Buffer.byteLength(result.transform.contentAfter, "utf8"), options.maxPreviewChars)
      : undefined;
    return makeEditOutput({
      status: "success",
      operation: op.operation,
      path: safePath,
      dryRun,
      committed: true,
      message: `obsidian_edit ${op.operation} committed for ${safePath}.`,
      target: result.target,
      preview,
    });
  } catch (error) {
    return mapEditFailure(error, op.operation, safePath, dryRun);
  }
}

function validateOperationFields(operation: ObsidianEditOperation, request: ObsidianEditRequest): ObsidianEditError | undefined {
  if (operation === "replace_section" || operation === "insert_under_heading") {
    if (!request.heading?.trim()) return makeEditError("MISSING_HEADING", "validation", "Section edit operations require an exact Markdown heading such as ## Plan.");
    if (request.content === undefined) return makeEditError("MISSING_CONTENT", "validation", "Section edit operations require Markdown content.");
    if (operation === "insert_under_heading" && request.content.trim() === "") return makeEditError("EMPTY_CONTENT", "validation", "insert_under_heading requires non-empty Markdown content.");
    return undefined;
  }
  if (operation === "replace_exact_text") {
    if (typeof request.oldText !== "string" || request.oldText.length === 0) return makeEditError("MISSING_OLD_TEXT", "validation", "replace_exact_text requires non-empty oldText.");
    if (!Object.prototype.hasOwnProperty.call(request, "newText") || typeof request.newText !== "string") return makeEditError("MISSING_NEW_TEXT", "validation", "replace_exact_text requires an explicit newText string, which may be empty.");
    return undefined;
  }
  if (!request.property?.trim()) return makeEditError("MISSING_PROPERTY", "validation", "Frontmatter operations require a top-level property name.");
  if (operation === "update_frontmatter" && !Object.prototype.hasOwnProperty.call(request, "value")) return makeEditError("MISSING_VALUE", "validation", "update_frontmatter requires an explicit JSON-compatible value field.");
  return undefined;
}

function buildTransform(operation: ObsidianEditOperation, request: ObsidianEditRequest, content: string): EditTransformResult {
  switch (operation) {
    case "replace_section":
      return planSectionTransform(content, operation, request.heading!, request.content ?? "");
    case "insert_under_heading":
      return planSectionTransform(content, operation, request.heading!, request.content ?? "");
    case "update_frontmatter":
      return planUpdateFrontmatter(content, request.property!, request.value);
    case "remove_frontmatter":
      return planRemoveFrontmatter(content, request.property!);
    case "replace_exact_text":
      return planExactTextTransform(content, request.oldText!, request.newText!);
  }
}

function mapEditFailure(error: unknown, operation: ObsidianEditOperation, safePath: string, dryRun: boolean): ObsidianEditOutput {
  if (error instanceof MarkdownSectionEditError) {
    if (error.code === "INVALID_HEADING") return validation(operation, safePath, dryRun, "INVALID_HEADING", error.message, error.details);
    if (error.code === "HEADING_NOT_FOUND") return notFound(operation, safePath, dryRun, "HEADING_NOT_FOUND", error.message, error.details);
    return ambiguous(operation, safePath, dryRun, "DUPLICATE_HEADING", error.message, error.details);
  }
  if (error instanceof FrontmatterEditError) {
    if (error.code === "PROPERTY_NOT_FOUND") return notFound(operation, safePath, dryRun, "PROPERTY_NOT_FOUND", error.message, error.details);
    if (error.code === "DUPLICATE_PROPERTY") return ambiguous(operation, safePath, dryRun, "DUPLICATE_PROPERTY", error.message, error.details);
    if (error.code === "MALFORMED_FRONTMATTER") return validation(operation, safePath, dryRun, "MALFORMED_FRONTMATTER", error.message, error.details);
    if (error.code === "MISSING_VALUE") return validation(operation, safePath, dryRun, "MISSING_VALUE", error.message, error.details);
  }
  if (error instanceof ExactTextEditError) {
    if (error.code === "OLD_TEXT_NOT_FOUND") return notFound(operation, safePath, dryRun, "OLD_TEXT_NOT_FOUND", error.message, error.details);
    if (error.code === "DUPLICATE_OLD_TEXT") return ambiguous(operation, safePath, dryRun, "DUPLICATE_OLD_TEXT", error.message, error.details);
    return makeEditOutput({
      status: "safety_refusal",
      operation,
      path: safePath,
      dryRun,
      message: error.message,
      error: makeEditError("FULL_NOTE_REPLACEMENT", "safety", error.message, true, error.details),
      warnings: ["Full-note replacement refused; no note was changed."],
    });
  }

  const mapped = editErrorFromUnknown(error);
  if (mapped.category === "not_found") {
    return notFound(operation, safePath, dryRun, "TARGET_MISSING", "Target note does not exist; obsidian_edit will not create it.");
  }
  if (mapped.category === "safety") {
    return makeEditOutput({
      status: "safety_refusal",
      operation,
      path: safePath,
      dryRun,
      message: "The target path is not safe for obsidian_edit.",
      error: makeEditError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe path refused; no note was changed."],
    });
  }
  if (mapped.category === "setup") {
    const code = mapped.code === "VAULT_NOT_WRITABLE" ? "VAULT_NOT_WRITABLE" : mapped.code === "VAULT_NOT_ACCESSIBLE" ? "VAULT_NOT_ACCESSIBLE" : "VAULT_PATH_REQUIRED";
    return makeEditOutput({
      status: "setup_required",
      operation,
      path: safePath,
      dryRun,
      message: "obsidian_edit setup is incomplete for local structured edits.",
      error: makeEditError(code, "setup", mapped.message),
      warnings: ["Open Obsidian once for auto-detection, or tell me your Obsidian vault folder path and I can remember it before retrying."],
    });
  }
  return makeEditOutput({
    status: "edit_failed",
    operation,
    path: safePath,
    dryRun,
    message: "obsidian_edit could not complete the edit safely.",
    error: makeEditError("EDIT_FAILED", "runtime", "The edit failed before a safe success result could be produced."),
    warnings: ["No overwrite, delete, rename, move, open, shell, network, scan, or arbitrary command action was attempted."],
  });
}

function setupRequired(operation: ObsidianEditOperation, dryRun: boolean, warning: string): ObsidianEditOutput {
  return makeEditOutput({
    status: "setup_required",
    operation,
    dryRun,
    message: "A local Obsidian vault path is required before obsidian_edit can run.",
    error: makeEditError("VAULT_PATH_REQUIRED", "setup", "Open Obsidian once for auto-detection, or tell me your Obsidian vault folder path and I can remember it before editing."),
    warnings: [warning],
  });
}

function validation(operation: ObsidianEditOperation, path: string, dryRun: boolean, code: ObsidianEditError["code"], message: string, details?: Record<string, unknown> | undefined): ObsidianEditOutput {
  return makeEditOutput({ status: "validation_error", operation, path, dryRun, message, error: makeEditError(code, "validation", message, true, details) });
}

function notFound(operation: ObsidianEditOperation, path: string, dryRun: boolean, code: ObsidianEditError["code"], message: string, details?: Record<string, unknown> | undefined): ObsidianEditOutput {
  return makeEditOutput({ status: "not_found", operation, path, dryRun, message, error: makeEditError(code, "not_found", message, true, details), warnings: ["No note was created or partially modified."] });
}

function ambiguous(operation: ObsidianEditOperation, path: string, dryRun: boolean, code: ObsidianEditError["code"], message: string, details?: Record<string, unknown> | undefined): ObsidianEditOutput {
  return makeEditOutput({ status: "ambiguous", operation, path, dryRun, message, error: makeEditError(code, "ambiguous", message, true, details), warnings: ["Ambiguous target refused; no note was changed."] });
}
