export type ObsidianWriteOperation = "create" | "append" | "create_folder";
export type ObsidianWriteStatus = "success" | "preview" | "validation_error" | "safety_refusal" | "conflict" | "missing_target" | "setup_required" | "write_failed";
export type ObsidianWriteErrorCategory = "validation" | "safety" | "conflict" | "setup" | "runtime";
export type ObsidianWriteNextActionType = "confirm_preview" | "retry_with_path" | "retry_with_create" | "retry_with_append" | "choose_different_path" | "configure_vault_path" | "answer_success" | "stop";

export interface ObsidianWriteRequest {
  operation?: string | undefined;
  path?: string | undefined;
  content?: string | undefined;
  dryRun?: boolean | undefined;
}

export interface WriteTargetSummary {
  path: string;
  targetKind?: "markdown" | "folder" | undefined;
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  folderExistsBefore?: boolean | undefined;
  folderExistsAfter?: boolean | undefined;
  parentExistsBefore?: boolean | undefined;
  createdParentDirectories?: boolean | undefined;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface WritePreview {
  operation: ObsidianWriteOperation;
  path: string;
  targetKind?: "markdown" | "folder" | undefined;
  wouldCreate: boolean;
  wouldAppend: boolean;
  wouldCreateFolder?: boolean | undefined;
  wouldCreateParentDirectories?: boolean | undefined;
  alreadyExists?: boolean | undefined;
  contentPreview?: string | undefined;
  contentChars?: number | undefined;
  previewTruncated?: boolean | undefined;
  expectedBytesAfter?: number | undefined;
}

export interface ObsidianWriteError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_PATH" | "UNSAFE_PATH" | "MISSING_CONTENT" | "EMPTY_CONTENT" | "CONTENT_NOT_ALLOWED" | "TARGET_EXISTS" | "TARGET_MISSING" | "TARGET_FOLDER_EXISTS" | "TARGET_NOT_FOLDER" | "PARENT_NOT_FOLDER" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "WRITE_FAILED";
  category: ObsidianWriteErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ObsidianWriteNextAction {
  priority: number;
  action: ObsidianWriteNextActionType;
  label: string;
  params?: {
    operation?: ObsidianWriteOperation | undefined;
    path?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ObsidianWriteOutput {
  tool: "obsidian_write";
  status: ObsidianWriteStatus;
  operation?: string | undefined;
  path?: string | undefined;
  dryRun: boolean;
  committed: boolean;
  message: string;
  target?: WriteTargetSummary | undefined;
  preview?: WritePreview | undefined;
  error?: ObsidianWriteError | undefined;
  warnings: string[];
  nextActions: ObsidianWriteNextAction[];
}

export interface WriteContentSummary {
  raw: string;
  chars: number;
  bytes: number;
  preview: string;
  previewTruncated: boolean;
}

export interface WritePlan {
  operation: ObsidianWriteOperation;
  path: string;
  content?: WriteContentSummary | undefined;
  dryRun: boolean;
}
