import { makeError, makeOutput, buildPreview, contentSummary, normalizeOperation } from "./write-guidance.js";
import { validateMarkdownContent } from "./note-validation.js";
import { LocalVaultWriter, writeErrorFromUnknown, type VaultWriter } from "./vault-writer.js";
import type { ObsidianWriteOutput, ObsidianWriteRequest, WriteContentSummary } from "./write-types.js";

export interface ObsidianWriteOptions {
  vaultRoot?: string | undefined;
  writer?: VaultWriter | undefined;
  maxPreviewChars?: number | undefined;
  writeDryRunValidationEnabled?: boolean | undefined;
  appendDryRunValidationEnabled?: boolean | undefined;
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
      message: "obsidian_write requires operation=create, operation=append, or operation=create_folder.",
      error: makeError("MISSING_OPERATION", "validation", "Provide operation=create, operation=append, or operation=create_folder."),
    });
  }

  if (!op.operation) {
    const code = op.forbidden ? "FORBIDDEN_OPERATION" : "UNSUPPORTED_OPERATION";
    return makeOutput({
      status: "safety_refusal",
      operation: requestedOperation,
      dryRun,
      committed: false,
      message: "obsidian_write only supports create, append, and create_folder; the requested operation was refused.",
      error: makeError(code, "safety", "Use only operation=create, operation=append, or operation=create_folder. Destructive, UI, shell, network, scan, discovery, and arbitrary command operations are not supported."),
      warnings: ["Forbidden or unsupported write operation refused; no note or folder was changed."],
    });
  }

  const requestedPath = request.path !== undefined ? request.path.trim() : op.operation === "create" ? inferCreatePath(request) : undefined;
  if (!requestedPath) {
    return makeOutput({
      status: "validation_error",
      operation: op.operation,
      dryRun,
      committed: false,
      message: op.operation === "create_folder" ? "obsidian_write create_folder requires a vault-relative folder path." : "obsidian_write needs a vault-relative Markdown path or a title it can turn into one.",
      error: makeError("MISSING_PATH", "validation", op.operation === "create_folder" ? "Provide a safe vault-relative folder path." : "Provide path or title for a new Markdown note."),
    });
  }

  let content: WriteContentSummary | undefined;
  if (op.operation === "create_folder") {
    if (request.content !== undefined) {
      return makeOutput({
        status: "validation_error",
        operation: op.operation,
        dryRun,
        committed: false,
        message: "obsidian_write create_folder does not accept content.",
        error: makeError("CONTENT_NOT_ALLOWED", "validation", "Remove content; create_folder only creates an explicit safe folder path and never writes note content."),
        warnings: ["Supplied content was rejected and was not written or ignored silently."],
      });
    }
  } else {
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
    content = contentSummary(request.content, options.maxPreviewChars);
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
      error: makeError("VAULT_PATH_REQUIRED", "setup", "Open Obsidian once for auto-detection, or tell me your Obsidian vault folder path and I can remember it before writing."),
      warnings: [mapped.message],
    });
  }

  let safePath: string;
  try {
    safePath = writer.normalizePath(requestedPath, op.operation);
  } catch (error) {
    const mapped = writeErrorFromUnknown(error);
    return makeOutput({
      status: "safety_refusal",
      operation: op.operation,
      dryRun,
      committed: false,
      message: op.operation === "create_folder" ? "The target folder path is not safe for obsidian_write." : "The target path is not safe for obsidian_write.",
      error: makeError("UNSAFE_PATH", "safety", mapped.message),
      warnings: ["Unsafe path refused; no note or folder was changed."],
    });
  }

  try {
    if (dryRun) {
      const target = await writer.preview({ operation: op.operation, path: safePath, content });
      const preview = buildPreview(op.operation, safePath, content, target);
      const shouldValidate = content && op.operation !== "create_folder" && (op.operation === "append" ? options.appendDryRunValidationEnabled !== false : options.writeDryRunValidationEnabled !== false);
      const validation = shouldValidate && content
        ? validateMarkdownContent(content.raw, {
          expectedPath: safePath,
          checkedScope: op.operation === "append" ? "write_append_content" : "write_create_content",
          extraWarnings: op.operation === "append" ? ["Append dry-run validation checked only the supplied appended content, not the complete resulting note."] : undefined,
          extraDegradedSignals: op.operation === "append" ? ["validation_scope"] : undefined,
        })
        : undefined;
      return makeOutput({
        status: "preview",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: op.operation === "create_folder" ? `Dry-run preview: obsidian_write would create folder ${safePath}.` : `Dry-run preview: obsidian_write would ${op.operation} ${safePath}.`,
        target,
        preview,
        validation,
      });
    }


    const target = await writer.commit({ operation: op.operation, path: safePath, content });
    return makeOutput({
      status: "success",
      operation: op.operation,
      path: safePath,
      dryRun,
      committed: true,
      message: op.operation === "create_folder" ? `obsidian_write create_folder committed for ${safePath}.` : `obsidian_write ${op.operation} committed for ${safePath}.`,
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
    if (mapped.code === "TARGET_FOLDER_EXISTS") {
      return makeOutput({
        status: "conflict",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "create_folder refused because the target folder already exists.",
        error: makeError("TARGET_FOLDER_EXISTS", "conflict", "Choose a different explicit folder path or stop if the existing folder is acceptable."),
        warnings: ["Existing folder was not modified."],
      });
    }
    if (mapped.code === "TARGET_NOT_FOLDER") {
      return makeOutput({
        status: "conflict",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "create_folder refused because a non-folder entry already exists at the target path.",
        error: makeError("TARGET_NOT_FOLDER", "conflict", "Choose a different explicit folder path; create_folder will not replace files."),
        warnings: ["Existing file or non-folder target was not modified."],
      });
    }
    if (mapped.code === "PARENT_NOT_FOLDER") {
      return makeOutput({
        status: "conflict",
        operation: op.operation,
        path: safePath,
        dryRun,
        committed: false,
        message: "create_folder refused because a non-folder entry blocks the parent path.",
        error: makeError("PARENT_NOT_FOLDER", "conflict", "Choose a different explicit folder path; create_folder will not replace files in the parent chain."),
        warnings: ["Existing parent-path file or non-folder entry was not modified."],
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
        message: op.operation === "create_folder" ? "The target folder path is not safe for obsidian_write." : "The target path is not safe for obsidian_write.",
        error: makeError("UNSAFE_PATH", "safety", mapped.message),
        warnings: ["Unsafe path refused; no note or folder was changed."],
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
        warnings: ["Open Obsidian once for auto-detection, or tell me your Obsidian vault folder path and I can remember it before retrying."],
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
      warnings: ["No overwrite, delete, rename, move, open, or destructive folder action was attempted."],
    });
  }
}

function inferCreatePath(request: ObsidianWriteRequest): string | undefined {
  const title = request.title?.trim() || headingFromMarkdown(request.content) || fallbackTitleFromContent(request.content);
  const fileName = titleToFileName(title);
  if (!fileName) return undefined;
  const folder = request.folderHint?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return folder ? `${folder}/${fileName}` : fileName;
}

function headingFromMarkdown(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const line = content.split(/\r?\n/u).find((candidate) => /^#{1,6}\s+\S/.test(candidate.trim()));
  return line?.replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, "").trim() || undefined;
}

function fallbackTitleFromContent(content: string | undefined): string | undefined {
  const clean = content?.replace(/[`*_>#\-[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.split(" ").slice(0, 8).join(" ");
}

function titleToFileName(title: string | undefined): string | undefined {
  const clean = title
    ?.normalize("NFKD")
    .replace(/[\\/:*?"<>|#^[\]\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!clean) return undefined;
  return clean.endsWith(".md") ? clean : `${clean}.md`;
}
