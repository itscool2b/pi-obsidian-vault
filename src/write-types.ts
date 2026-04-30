export type ObsidianWriteOperation = "create" | "append";
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
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  parentExistsBefore?: boolean | undefined;
  createdParentDirectories?: boolean | undefined;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface WritePreview {
  operation: ObsidianWriteOperation;
  path: string;
  wouldCreate: boolean;
  wouldAppend: boolean;
  wouldCreateParentDirectories?: boolean | undefined;
  contentPreview: string;
  contentChars: number;
  previewTruncated: boolean;
  expectedBytesAfter?: number | undefined;
}

export interface ObsidianWriteError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_PATH" | "UNSAFE_PATH" | "MISSING_CONTENT" | "EMPTY_CONTENT" | "TARGET_EXISTS" | "TARGET_MISSING" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "WRITE_FAILED";
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
  content: WriteContentSummary;
  dryRun: boolean;
}
