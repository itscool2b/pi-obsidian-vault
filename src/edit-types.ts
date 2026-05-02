import type { CommitTokenErrorCode, CommitTokenMetadata } from "./commit-token-types.js";

export type ObsidianEditOperation = "replace_section" | "insert_under_heading" | "update_frontmatter" | "remove_frontmatter" | "replace_exact_text";
export type ObsidianEditStatus = "success" | "preview" | "validation_error" | "safety_refusal" | "not_found" | "ambiguous" | "setup_required" | "edit_failed";
export type ObsidianEditErrorCategory = "validation" | "safety" | "not_found" | "ambiguous" | "setup" | "runtime";
export type ObsidianEditNextActionType = "confirm_preview" | "retry_with_path" | "retry_with_heading" | "retry_with_property" | "configure_vault_path" | "ask_user_to_disambiguate" | "answer_success" | "stop";
export type ObsidianEditTargetKind = "section" | "frontmatter" | "exact_text";
export type ObsidianEditChange = "replace" | "insert" | "set" | "remove";

export interface ObsidianEditRequest {
  operation?: string | undefined;
  path?: string | undefined;
  heading?: string | undefined;
  content?: string | undefined;
  property?: string | undefined;
  value?: unknown;
  oldText?: string | undefined;
  newText?: string | undefined;
  dryRun?: boolean | undefined;
  confirmationToken?: string | undefined;
}

export interface EditHeadingSummary {
  level: number;
  text: string;
  line?: number | undefined;
}

export interface EditPropertySummary {
  name: string;
  line?: number | undefined;
}

export interface EditTargetSummary {
  path: string;
  existsBefore: boolean;
  existsAfter?: boolean | undefined;
  bytesBefore?: number | undefined;
  bytesAfter?: number | undefined;
  heading?: EditHeadingSummary | undefined;
  property?: EditPropertySummary | undefined;
}

export interface EditPreview {
  operation: ObsidianEditOperation;
  path: string;
  targetKind: ObsidianEditTargetKind;
  change: ObsidianEditChange;
  heading?: EditHeadingSummary | undefined;
  property?: EditPropertySummary | undefined;
  beforePreview?: string | undefined;
  afterPreview?: string | undefined;
  insertedPreview?: string | undefined;
  contentChars?: number | undefined;
  valuePreview?: string | undefined;
  valueType?: string | undefined;
  oldTextPreview?: string | undefined;
  newTextPreview?: string | undefined;
  oldTextChars?: number | undefined;
  newTextChars?: number | undefined;
  changedChars?: number | undefined;
  changedBytes?: number | undefined;
  previewTruncated?: boolean | undefined;
  expectedBytesAfter?: number | undefined;
  bodyPreserved?: boolean | undefined;
}

export interface ObsidianEditError {
  code: "MISSING_OPERATION" | "UNSUPPORTED_OPERATION" | "FORBIDDEN_OPERATION" | "MISSING_PATH" | "UNSAFE_PATH" | "TARGET_MISSING" | "MISSING_HEADING" | "INVALID_HEADING" | "HEADING_NOT_FOUND" | "DUPLICATE_HEADING" | "MISSING_CONTENT" | "EMPTY_CONTENT" | "MISSING_PROPERTY" | "PROPERTY_NOT_FOUND" | "DUPLICATE_PROPERTY" | "MISSING_VALUE" | "MALFORMED_FRONTMATTER" | "MISSING_OLD_TEXT" | "MISSING_NEW_TEXT" | "OLD_TEXT_NOT_FOUND" | "DUPLICATE_OLD_TEXT" | "FULL_NOTE_REPLACEMENT" | "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE" | "EDIT_FAILED" | CommitTokenErrorCode;
  category: ObsidianEditErrorCategory;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown> | undefined;
}

export interface ObsidianEditNextAction {
  priority: number;
  action: ObsidianEditNextActionType;
  label: string;
  params?: {
    operation?: ObsidianEditOperation | undefined;
    path?: string | undefined;
    heading?: string | undefined;
    property?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ObsidianEditOutput extends CommitTokenMetadata {
  tool: "obsidian_edit";
  status: ObsidianEditStatus;
  operation?: string | undefined;
  path?: string | undefined;
  dryRun: boolean;
  committed: boolean;
  message: string;
  target?: EditTargetSummary | undefined;
  preview?: EditPreview | undefined;
  error?: ObsidianEditError | undefined;
  warnings: string[];
  nextActions: ObsidianEditNextAction[];
}

export interface EditTransformResult {
  contentAfter: string;
  targetKind: ObsidianEditTargetKind;
  change: ObsidianEditChange;
  heading?: EditHeadingSummary | undefined;
  property?: EditPropertySummary | undefined;
  beforePreview?: string | undefined;
  afterPreview?: string | undefined;
  insertedPreview?: string | undefined;
  contentChars?: number | undefined;
  valuePreview?: string | undefined;
  valueType?: string | undefined;
  oldTextPreview?: string | undefined;
  newTextPreview?: string | undefined;
  oldTextChars?: number | undefined;
  newTextChars?: number | undefined;
  changedChars?: number | undefined;
  changedBytes?: number | undefined;
  previewTruncated?: boolean | undefined;
  bodyPreserved?: boolean | undefined;
}
