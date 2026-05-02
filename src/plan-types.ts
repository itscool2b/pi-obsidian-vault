import type { BudgetProfile } from "./retrieval-types.js";

export const PLAN_MAX_OPERATIONS = 25;

export type PlanStatus = "success" | "validation_error" | "safety_refusal" | "setup_required" | "failure";
export type PlanIssueSeverity = "error" | "warning" | "info";

export type PlanIssueCode =
  | "MISSING_OPERATIONS"
  | "OPERATIONS_NOT_ARRAY"
  | "EMPTY_OPERATIONS"
  | "TOO_MANY_OPERATIONS"
  | "INVALID_MAX_OPERATIONS"
  | "OPERATION_NOT_OBJECT"
  | "MISSING_OPERATION"
  | "MISSING_TOOL_OR_CATEGORY"
  | "TOOL_CATEGORY_MISMATCH"
  | "UNSUPPORTED_TOOL"
  | "UNSUPPORTED_OPERATION"
  | "FORBIDDEN_OPERATION"
  | "MISSING_PATH"
  | "MISSING_FROM_PATH"
  | "MISSING_TO_PATH"
  | "MISSING_TRASH_PATH"
  | "MISSING_CONTENT"
  | "EMPTY_CONTENT"
  | "CONTENT_NOT_ALLOWED"
  | "MISSING_HEADING"
  | "MISSING_PROPERTY"
  | "MISSING_VALUE"
  | "MISSING_OLD_TEXT"
  | "MISSING_NEW_TEXT"
  | "UNSAFE_PATH"
  | "UNSAFE_FROM_PATH"
  | "UNSAFE_TO_PATH"
  | "UNSAFE_TRASH_PATH"
  | "UNSAFE_TRASH_FOLDER"
  | "UNSAFE_EXPECTED_PATH"
  | "NOTE_NOT_MARKDOWN"
  | "TARGET_NOT_MARKDOWN"
  | "SAME_PATH"
  | "DUPLICATE_OPERATION_ID"
  | "DUPLICATE_DESTINATION"
  | "SOURCE_NOT_FOUND"
  | "TARGET_MISSING"
  | "TARGET_EXISTS"
  | "PARENT_MISSING"
  | "PARENT_NOT_FOLDER"
  | "TRASH_PATH_OUTSIDE_TRASH"
  | "TRASH_TARGET_EXISTS"
  | "READ_AFTER_MOVE_OLD_PATH"
  | "APPEND_AFTER_MOVE_OLD_PATH"
  | "EDIT_AFTER_TRASH"
  | "WRITE_AFTER_TRASH"
  | "DRY_RUN_FALSE_IGNORED"
  | "CHECK_UNAVAILABLE";

export interface ObsidianPlanRequest {
  operations?: unknown[] | undefined;
  maxOperations?: number | undefined;
  budget?: BudgetProfile | undefined;
  explain?: boolean | undefined;
}

export interface PlannedOperation {
  id?: string | undefined;
  tool?: string | undefined;
  category?: string | undefined;
  operation?: string | undefined;
  path?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  trashPath?: string | undefined;
  trashFolder?: string | undefined;
  content?: string | undefined;
  heading?: string | undefined;
  property?: string | undefined;
  value?: unknown;
  oldText?: string | undefined;
  newText?: string | undefined;
  expectedPath?: string | undefined;
  maxRelated?: number | undefined;
  includeBacklinks?: boolean | undefined;
  includeOutgoing?: boolean | undefined;
  includeSections?: boolean | undefined;
  dryRun?: boolean | undefined;
  [key: string]: unknown;
}

export interface PlanIssue {
  code: PlanIssueCode;
  severity: PlanIssueSeverity;
  message: string;
  operationIndex?: number | undefined;
  operationId?: string | undefined;
  relatedOperationIndex?: number | undefined;
  relatedOperationId?: string | undefined;
  path?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  trashPath?: string | undefined;
  trashFolder?: string | undefined;
  expectedPath?: string | undefined;
}

export interface PlanConflict {
  code: PlanIssueCode;
  severity: "error" | "warning";
  operationIndex: number;
  operationId?: string | undefined;
  relatedOperationIndex?: number | undefined;
  relatedOperationId?: string | undefined;
  path?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  trashPath?: string | undefined;
  trashFolder?: string | undefined;
}

export interface PlannedEffects {
  notesCreated: string[];
  notesAppended: string[];
  notesEdited: string[];
  foldersCreated: string[];
  notesMoved: Array<{ fromPath: string; toPath: string }>;
  notesTrashed: Array<{ path: string; trashPath: string }>;
  notesRestored: Array<{ trashPath: string; toPath: string }>;
  notesCopied: Array<{ fromPath: string; toPath: string }>;
  notesReadOrValidated: string[];
  affectedPaths: string[];
}

export interface PlanSummary {
  previewOnly: true;
  wouldMutateIfExecutedIndividually: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  conflictCount: number;
  operationCount: number;
}

export interface PlanNextAction {
  priority: number;
  action: "run_individual_dry_runs" | "revise_plan" | "provide_operations" | "configure_vault";
  label: string;
}

export interface ObsidianPlanOutput {
  tool: "obsidian_plan";
  status: PlanStatus;
  operationCount: number;
  valid: boolean;
  issues: PlanIssue[];
  plannedEffects: PlannedEffects;
  conflicts: PlanConflict[];
  warnings: string[];
  degradedSignals: string[];
  summary: PlanSummary;
  nextActions: PlanNextAction[];
}

export interface PlanPathState {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  content?: string | undefined;
}

export interface PlanInspector {
  noteState(path: string, readContent?: boolean): Promise<PlanPathState>;
  folderState(path: string): Promise<PlanPathState>;
}
