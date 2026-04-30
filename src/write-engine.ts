import { makeError, makeOutput, buildPreview, contentSummary, normalizeOperation } from "./write-guidance.js";
import { LocalVaultWriter, writeErrorFromUnknown, type VaultWriter } from "./vault-writer.js";
import type { ObsidianWriteOutput, ObsidianWriteRequest } from "./write-types.js";

export interface ObsidianWriteOptions {
  vaultRoot?: string | undefined;
  writer?: VaultWriter | undefined;
}

export async function obsidianWrite(request: ObsidianWriteRequest, options: ObsidianWriteOptions = {}): Promise<ObsidianWriteOutput> {
  const dryRun = request.dryRun ?? true;
  const op = normalizeOperation(request.operation);
  const requestedOperation = op.requested ?? request.operation?.trim();

  if (!request.operation?.trim()) {
    return makeOutput({
      status: "validation_error",
      dryRun,
      committed: false,
      message: "obsidian_write requires operation=create or operation=append.",
      error: makeError("MISSING_OPERATION", "validation", "Provide operation=create or operation=append."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      committed: false,
      message: "obsidian_write only supports create and append; the requested operation was refused.",
      error: makeError(code, "safety", "Use only operation=create or operation=append. Destructive, UI, shell, network, scan, and arbitrary command operations are not supported."),
      warnings: ["Forbidden or unsupported write operation refused; no note was changed."],
    });
  }

  if (!request.path?.trim()) {
    return makeOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      committed: false,
      message: "obsidian_write requires an explicit vault-relative Markdown path.",
      error: makeError("MISSING_PATH", "validation", "Provide an explicit safe vault-relative Markdown path; obsidian_write will not infer one."),
    });
  }

  if (request.content === undefined) {
    return makeOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      committed: false,
      message: "obsidian_write requires Markdown content.",
      error: makeError("MISSING_CONTENT", "validation", "Provide non-empty Markdown content for create or append."),
    });
  }

  if (request.content.trim() === "") {
    return makeOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      committed: false,
      message: "obsidian_write content must not be empty.",
      error: makeError("EMPTY_CONTENT", "validation", "Provide non-empty Markdown content for create or append."),
    });
  }

  let writer: VaultWriter;
  try {
    writer = options.writer ?? new LocalVaultWriter(options.vaultRoot);
  } catch (error) {
    const mapped = writeErrorFromUnknown(error);
    return makeOutput({
      status: "setup_required",
      operation: op.operation,
      dryRun,
      committed: false,
      message: "A local Obsidian vault path is required before obsidian_write can run.",
      error: makeError("VAULT_PATH_REQUIRED", "setup", "Configure OBSIDIAN_VAULT_PATH or ~/.pi/agent/obsidian-vault.json with a vaultPath before writing."),
      warnings: [mapped.message],
    });
  }

  let safePath: string;
  try {
    safePath = writer.normalizePath(request.path);
  } catch (error) {
    const mapped = writeErrorFromUnknown(error);
    return makeOutput({
      status: "safety_refusal",
      operation: op.operation,
      dryRun,
      committed: false,
      message: "The target path is not safe for obsidian_write.",
      error: makeError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe path refused; no note was changed."],
    });
  }

  const content = contentSummary(request.content);
  try {
    if (dryRun) {
      const target = await writer.preview({ operation: op.operation, path: safePath, content });
      const preview = buildPreview(op.operation, safePath, content, target);
      return makeOutput({
        status: "preview",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: `Dry-run preview: obsidian_write would ${op.operation} ${safePath}.`,
        target,
        preview,
      });
    }

    const target = await writer.commit({ operation: op.operation, path: safePath, content });
    return makeOutput({
      status: "success",
      operation: op.operation,
      path: safePath,
      dryRun,
      committed: true,
      message: `obsidian_write ${op.operation} committed for ${safePath}.`,
      target,
    });
  } catch (error) {
    const mapped = writeErrorFromUnknown(error);
    if (mapped.code === "TARGET_EXISTS") {
      return makeOutput({
        status: "conflict",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "Create refused because the target note already exists.",
        error: makeError("TARGET_EXISTS", "conflict", "Choose a different explicit Markdown path or use append mode if adding to the existing note."),
        warnings: ["Existing note was not overwritten."],
      });
    }
    if (mapped.code === "TARGET_MISSING") {
      return makeOutput({
        status: "missing_target",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "Append refused because the target note does not exist.",
        error: makeError("TARGET_MISSING", "conflict", "Use create mode if a new note is intended."),
        warnings: ["Missing note was not created implicitly."],
      });
    }
    if (mapped.category === "safety") {
      return makeOutput({
        status: "safety_refusal",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "The target path is not safe for obsidian_write.",
        error: makeError("UNSAFE_PATH", "safety", mapped.message),
        warnings: ["Unsafe path refused; no note was changed."],
      });
    }
    if (mapped.category === "setup") {
      const code = mapped.code === "VAULT_NOT_WRITABLE" ? "VAULT_NOT_WRITABLE" : mapped.code === "VAULT_NOT_ACCESSIBLE" ? "VAULT_NOT_ACCESSIBLE" : "VAULT_PATH_REQUIRED";
      return makeOutput({
        status: "setup_required",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "obsidian_write setup is incomplete for local vault writes.",
        error: makeError(code, "setup", mapped.message),
        warnings: ["Configure an accessible writable local vault path before retrying."],
      });
    }
    return makeOutput({
      status: "write_failed",
      operation: op.operation,
      path: safePath,
      dryRun,
      committed: false,
      message: "obsidian_write could not complete the write safely.",
      error: makeError("WRITE_FAILED", "runtime", "The write failed before a safe success result could be produced."),
      warnings: ["No overwrite, delete, rename, move, or open action was attempted."],
    });
  }
}
