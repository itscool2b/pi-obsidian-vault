export type ObsidianDestroyOperation = "delete_note" | "delete_folder" | "replace_note" | "empty_trash";
export type ObsidianDestroyStatus = "success" | "preview" | "validation_error" | "safety_refusal" | "not_found" | "conflict" | "setup_required" | "destroy_failed";
export type ObsidianDestroyErrorCategory = "validation" | "safety" | "not_found" | "conflict" | "setup" | "runtime";
export type ObsidianDestroyNextActionType = "confirm_preview" | "retry_with_path" | "retry_with_content" | "configure_vault_path" | "answer_success" | "stop";

export interface ObsidianDestroyRequest {
  operation?: string | undefined;
  path?: string | undefined;
  content?: string | undefined;
  dryRun?: boolean | undefined;
}

export interface DestroyNoteTargetSummary {
  path: string;
  targetKind: "markdown";
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  bytesBefore?: number | undefined;
}

export interface ReplaceNoteTargetSummary {
  path: string;
  targetKind: "markdown";
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface DestroyFolderTargetSummary {
  path: string;
  targetKind: "folder";
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  entryCount: number;
  fileCount: number;
  folderCount: number;
  bytesBefore: number;
}

export interface EmptyTrashTargetSummary {
  trashFolder: string;
  targetKind: "trash_folder";
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  entryCount: number;
  fileCount: number;
  folderCount: number;
  bytesBefore: number;
}

export type DestroyTargetSummary = DestroyNoteTargetSummary | ReplaceNoteTargetSummary | DestroyFolderTargetSummary | EmptyTrashTargetSummary;

export interface DestroyPreview {
  operation: ObsidianDestroyOperation;
  path?: string | undefined;
  trashFolder?: string | undefined;
  targetKind: DestroyTargetSummary["targetKind"];
  wouldDelete: boolean;
  wouldReplace: boolean;
  wouldEmptyTrash: boolean;
  permanentlyDeletes: true;
  entryCount?: number | undefined;
  fileCount?: number | undefined;
  folderCount?: number | undefined;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
  beforePreview?: string | undefined;
  afterPreview?: string | undefined;
  previewTruncated?: boolean | undefined;
}

export interface ObsidianDestroyError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_PATH" | "MISSING_CONTENT" | "EMPTY_CONTENT" | "CONTENT_NOT_ALLOWED" | "PATH_NOT_ALLOWED" | "UNSAFE_PATH" | "TARGET_MISSING" | "TARGET_NOT_MARKDOWN" | "TARGET_IS_FOLDER" | "TARGET_NOT_FOLDER" | "TARGET_NOT_FILE" | "TARGET_IS_SYMLINK" | "TARGET_SPECIAL_FILE" | "FOLDER_TOO_LARGE" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "DELETE_FAILED" | "REPLACE_FAILED" | "EMPTY_TRASH_FAILED";
  category: ObsidianDestroyErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ObsidianDestroyNextAction {
  priority: number;
  action: ObsidianDestroyNextActionType;
  label: string;
  params?: {
    operation?: ObsidianDestroyOperation | undefined;
    path?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ObsidianDestroyOutput {
  tool: "obsidian_destroy";
  status: ObsidianDestroyStatus;
  operation?: string | undefined;
  path?: string | undefined;
  trashFolder?: string | undefined;
  dryRun: boolean;
  committed: boolean;
  message: string;
  target?: DestroyTargetSummary | undefined;
  preview?: DestroyPreview | undefined;
  error?: ObsidianDestroyError | undefined;
  warnings: string[];
  nextActions: ObsidianDestroyNextAction[];
}
