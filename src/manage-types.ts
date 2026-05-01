export type ObsidianManageOperation = "move_note" | "trash_note" | "restore_note";
export type ObsidianManageStatus = "success" | "preview" | "validation_error" | "safety_refusal" | "conflict" | "not_found" | "setup_required" | "manage_failed";
export type ObsidianManageErrorCategory = "validation" | "safety" | "conflict" | "not_found" | "setup" | "runtime";
export type ObsidianManageNextActionType = "confirm_preview" | "retry_with_from_path" | "retry_with_to_path" | "retry_with_path" | "retry_with_trash_path" | "retry_with_trash_folder" | "choose_different_path" | "create_parent_folder" | "configure_vault_path" | "answer_success" | "stop";

export interface ObsidianManageRequest {
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  path?: string | undefined;
  trashPath?: string | undefined;
  trashFolder?: string | undefined;
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

export interface TrashTargetSummary {
  path: string;
  trashFolder: string;
  trashPath: string;
  targetKind: "markdown";
  trashFolderDefaulted: boolean;
  sourceExistsBefore: boolean;
  sourceExistsAfter?: boolean | undefined;
  trashFolderExistsBefore: boolean;
  trashFolderExistsAfter?: boolean | undefined;
  trashFolderWouldBeCreated: boolean;
  trashFolderCreated?: boolean | undefined;
  trashTargetExistsBefore: boolean;
  trashTargetExistsAfter?: boolean | undefined;
  wouldOverwrite: false;
  wouldPermanentlyDelete: false;
  wouldRewriteLinks: false;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface RestoreTargetSummary {
  trashPath: string;
  toPath: string;
  trashFolder: string;
  targetKind: "markdown";
  trashFolderDefaulted: boolean;
  trashSourceExistsBefore: boolean;
  trashSourceExistsAfter?: boolean | undefined;
  destinationExistsBefore: boolean;
  destinationExistsAfter?: boolean | undefined;
  parentExistsBefore: boolean;
  parentIsFolderBefore: boolean;
  wouldOverwrite: false;
  wouldCreateParent: false;
  wouldPermanentlyDelete: false;
  wouldRewriteLinks: false;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
}

export interface ManagePreview {
  operation: "move_note";
  fromPath: string;
  toPath: string;
  targetKind: "markdown";
  wouldMove: boolean;
  wouldRename: boolean;
  wouldChangeParent: boolean;
  wouldOverwrite: false;
  wouldRewriteLinks: false;
}

export interface TrashPreview {
  operation: "trash_note";
  path: string;
  trashFolder: string;
  trashPath: string;
  targetKind: "markdown";
  wouldTrash: boolean;
  wouldCreateTrashFolder: boolean;
  wouldOverwrite: false;
  wouldPermanentlyDelete: false;
  wouldRewriteLinks: false;
}

export interface RestorePreview {
  operation: "restore_note";
  trashPath: string;
  toPath: string;
  trashFolder: string;
  targetKind: "markdown";
  wouldRestore: boolean;
  wouldOverwrite: false;
  wouldCreateParent: false;
  wouldPermanentlyDelete: false;
  wouldRewriteLinks: false;
}

export interface ObsidianManageError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_FROM_PATH" | "MISSING_TO_PATH" | "MISSING_PATH" | "MISSING_TRASH_PATH" | "UNSAFE_FROM_PATH" | "UNSAFE_TO_PATH" | "UNSAFE_PATH" | "UNSAFE_TRASH_PATH" | "UNSAFE_TRASH_FOLDER" | "SAME_PATH" | "SOURCE_NOT_FOUND" | "SOURCE_NOT_NOTE" | "SOURCE_NOT_MARKDOWN" | "SOURCE_IS_FOLDER" | "SOURCE_NOT_FILE" | "TRASH_SOURCE_NOT_FOUND" | "TRASH_SOURCE_NOT_MARKDOWN" | "TRASH_SOURCE_IS_FOLDER" | "TRASH_SOURCE_NOT_FILE" | "TARGET_NOT_MARKDOWN" | "TRASH_PATH_OUTSIDE_TRASH" | "TARGET_EXISTS" | "PARENT_MISSING" | "PARENT_NOT_FOLDER" | "TRASH_FOLDER_NOT_FOLDER" | "TRASH_TARGET_EXISTS" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "MOVE_FAILED" | "TRASH_FAILED" | "RESTORE_FAILED";
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
    path?: string | undefined;
    trashPath?: string | undefined;
    trashFolder?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ObsidianManageOutput {
  tool: "obsidian_manage";
  status: ObsidianManageStatus;
  operation?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  path?: string | undefined;
  trashFolder?: string | undefined;
  trashPath?: string | undefined;
  dryRun: boolean;
  committed: boolean;
  message: string;
  target?: ManageTargetSummary | TrashTargetSummary | RestoreTargetSummary | undefined;
  preview?: ManagePreview | TrashPreview | RestorePreview | undefined;
  error?: ObsidianManageError | undefined;
  warnings: string[];
  nextActions: ObsidianManageNextAction[];
}
