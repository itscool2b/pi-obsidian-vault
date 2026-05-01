export type ObsidianManageOperation = "move_note";
export type ObsidianManageStatus = "success" | "preview" | "validation_error" | "safety_refusal" | "conflict" | "not_found" | "setup_required" | "manage_failed";
export type ObsidianManageErrorCategory = "validation" | "safety" | "conflict" | "not_found" | "setup" | "runtime";
export type ObsidianManageNextActionType = "confirm_preview" | "retry_with_from_path" | "retry_with_to_path" | "choose_different_path" | "create_parent_folder" | "configure_vault_path" | "answer_success" | "stop";

export interface ObsidianManageRequest {
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  dryRun?: boolean | undefined;
}

export interface ManageTargetSummary {
  fromPath: string;
  toPath: string;
  targetKind: "markdown";
  sourceExistsBefore: boolean;
  sourceExistsAfter?: boolean | undefined;
  destinationExistsBefore: boolean;
  destinationExistsAfter?: boolean | undefined;
  parentExistsBefore: boolean;
  parentIsFolderBefore: boolean;
  renamedWithinFolder: boolean;
  movedToDifferentFolder: boolean;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface ManagePreview {
  operation: ObsidianManageOperation;
  fromPath: string;
  toPath: string;
  targetKind: "markdown";
  wouldMove: boolean;
  wouldRename: boolean;
  wouldChangeParent: boolean;
  wouldOverwrite: false;
  wouldRewriteLinks: false;
}

export interface ObsidianManageError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_FROM_PATH" | "MISSING_TO_PATH" | "UNSAFE_FROM_PATH" | "UNSAFE_TO_PATH" | "UNSAFE_PATH" | "SAME_PATH" | "SOURCE_NOT_FOUND" | "SOURCE_NOT_NOTE" | "TARGET_EXISTS" | "PARENT_MISSING" | "PARENT_NOT_FOLDER" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "MOVE_FAILED";
  category: ObsidianManageErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ObsidianManageNextAction {
  priority: number;
  action: ObsidianManageNextActionType;
  label: string;
  params?: {
    operation?: ObsidianManageOperation | undefined;
    fromPath?: string | undefined;
    toPath?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ObsidianManageOutput {
  tool: "obsidian_manage";
  status: ObsidianManageStatus;
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  dryRun: boolean;
  committed: boolean;
  message: string;
  target?: ManageTargetSummary | undefined;
  preview?: ManagePreview | undefined;
  error?: ObsidianManageError | undefined;
  warnings: string[];
  nextActions: ObsidianManageNextAction[];
}
