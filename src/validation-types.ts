import type { BudgetProfile } from "./retrieval-types.js";

export type ValidationTarget = "existing_note" | "proposed_content";
export type ValidationStatus = "success" | "validation_error" | "safety_refusal" | "not_found" | "setup_required" | "failure";
export type ValidationIssueSeverity = "error" | "warning" | "info";
export type ValidationHighestSeverity = ValidationIssueSeverity | "none";
export type ValidationCheckedScope = "existing_note" | "proposed_content" | "write_create_content" | "write_append_content";
export type ValidationDegradedSignal = "parsing" | "budget" | "issues_truncated" | "content_size" | "validation_scope";
export type ValidationErrorCategory = "validation" | "safety" | "not_found" | "setup" | "runtime";
export type ValidationNextActionType = "fix_errors" | "review_warnings" | "proceed_if_user_confirms" | "retry_with_safe_path" | "retry_with_content" | "reduce_content" | "configure_obsidian" | "stop";

export type ValidationIssueCode =
  | "FRONTMATTER_PARSE_ERROR"
  | "FRONTMATTER_MISSING_CLOSING_DELIMITER"
  | "FRONTMATTER_NON_OBJECT"
  | "FRONTMATTER_DUPLICATE_KEY"
  | "DUPLICATE_HEADING"
  | "MISSING_FIRST_HEADING"
  | "HEADING_LEVEL_JUMP"
  | "EMPTY_SECTION"
  | "MALFORMED_MARKDOWN_LINK"
  | "SUSPICIOUS_ABSOLUTE_PATH"
  | "SUSPICIOUS_WINDOWS_ABSOLUTE_PATH"
  | "SUSPICIOUS_UNC_PATH"
  | "SUSPICIOUS_TRAVERSAL_PATH"
  | "SUSPICIOUS_OBSIDIAN_PATH"
  | "OVERSIZED_CONTENT"
  | "TITLE_PATH_MISMATCH"
  | "BROAD_DUMP_WORDING"
  | "UNSAFE_OPERATION_WORDING"
  | "LARGE_CODE_FENCE"
  | "EMBEDDED_BLOB";

export type ValidationErrorCode =
  | "MISSING_TARGET"
  | "UNSUPPORTED_TARGET"
  | "MISSING_PATH"
  | "MISSING_CONTENT"
  | "EMPTY_CONTENT"
  | "PATH_NOT_STRING"
  | "EXPECTED_PATH_NOT_STRING"
  | "CONTENT_NOT_STRING"
  | "UNSAFE_PATH"
  | "UNSAFE_EXPECTED_PATH"
  | "NOTE_NOT_MARKDOWN"
  | "EXPECTED_PATH_NOT_MARKDOWN"
  | "INVALID_MAX_ISSUES"
  | "NOTE_NOT_FOUND"
  | "OBSIDIAN_UNAVAILABLE"
  | "VALIDATION_FAILED";

export interface ObsidianValidateRequest {
  target?: string | undefined;
  path?: unknown;
  content?: unknown;
  expectedPath?: unknown;
  maxIssues?: unknown;
  budget?: BudgetProfile | undefined;
}

export interface ValidationIssueLocation {
  line?: number | undefined;
  heading?: string | undefined;
  frontmatterKey?: string | undefined;
  linkText?: string | undefined;
}

export interface ValidationIssue {
  code: ValidationIssueCode;
  severity: ValidationIssueSeverity;
  message: string;
  location?: ValidationIssueLocation | undefined;
  path?: string | undefined;
}

export interface ValidationSummary {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  returnedIssueCount: number;
  omittedIssueCount: number;
  highestSeverity: ValidationHighestSeverity;
  workflowNeutral: true;
  checkedScope: ValidationCheckedScope;
}

export interface ValidationNextAction {
  priority: number;
  action: ValidationNextActionType;
  label: string;
  params?: {
    target?: ValidationTarget | undefined;
    path?: string | undefined;
    expectedPath?: string | undefined;
    dryRun?: boolean | undefined;
  } | undefined;
}

export interface ValidationError {
  code: ValidationErrorCode;
  category: ValidationErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ValidationMetadata {
  target: "proposed_content";
  expectedPath?: string | undefined;
  valid: boolean;
  issueCount: number;
  issues: ValidationIssue[];
  warnings: string[];
  degradedSignals: ValidationDegradedSignal[];
  summary: ValidationSummary;
}

export interface ObsidianValidateOutput {
  tool: "obsidian_validate";
  status: ValidationStatus;
  target?: ValidationTarget | undefined;
  path?: string | undefined;
  expectedPath?: string | undefined;
  valid: boolean;
  issueCount: number;
  issues: ValidationIssue[];
  warnings: string[];
  degradedSignals: ValidationDegradedSignal[];
  summary: ValidationSummary;
  nextActions: ValidationNextAction[];
  error?: ValidationError | undefined;
}

export interface ValidationBuildOptions {
  expectedPath?: string | undefined;
  budget?: BudgetProfile | undefined;
  maxIssues?: number | undefined;
  checkedScope?: ValidationCheckedScope | undefined;
  extraWarnings?: string[] | undefined;
  extraDegradedSignals?: ValidationDegradedSignal[] | undefined;
}
