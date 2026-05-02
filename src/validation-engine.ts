import { validateMarkdownContent, normalizeValidationExpectedPath, normalizeValidationMaxIssues, normalizeValidationNotePath, validationError } from "./note-validation.js";
import type { BudgetProfile, ObsidianCliBackend } from "./retrieval-types.js";
import type { ObsidianValidateOutput, ObsidianValidateRequest, ValidationCheckedScope, ValidationError, ValidationNextAction, ValidationStatus, ValidationTarget } from "./validation-types.js";

export interface ObsidianValidateOptions {
  defaultBudget?: BudgetProfile | undefined;
  setupErrors?: string[] | undefined;
  setupWarnings?: string[] | undefined;
}

export async function obsidianValidate(backend: ObsidianCliBackend | undefined, request: ObsidianValidateRequest, options: ObsidianValidateOptions = {}): Promise<ObsidianValidateOutput> {
  const target = normalizeTarget(request.target);
  const budget = request.budget ?? options.defaultBudget ?? "standard";
  const maxIssues = normalizeValidationMaxIssues(request.maxIssues);
  if (!maxIssues.ok) {
    return emptyValidationOutput({ status: "validation_error", target: target.value, checkedScope: checkedScopeFor(target.value), error: maxIssues.error, warnings: [maxIssues.warning], action: retryActionFor(target.value) });
  }

  if (!target.ok) {
    return emptyValidationOutput({ status: "validation_error", checkedScope: "proposed_content", error: target.error, warnings: [target.warning], action: { priority: 1, action: "retry_with_content", label: "Retry with target=existing_note and path, or target=proposed_content and content." } });
  }

  const expectedPath = normalizeValidationExpectedPath(request.expectedPath);
  if (!expectedPath.ok) {
    return emptyValidationOutput({ status: expectedPath.status, target: target.value, checkedScope: checkedScopeFor(target.value), error: expectedPath.error, warnings: [expectedPath.warning], action: expectedPath.status === "safety_refusal" ? stopAction() : retryActionFor(target.value) });
  }

  if (target.value === "proposed_content") {
    if (request.content === undefined) {
      return emptyValidationOutput({ status: "validation_error", target: target.value, checkedScope: "proposed_content", expectedPath: expectedPath.path, error: validationError("MISSING_CONTENT", "validation", "Provide explicit Markdown content for target=proposed_content."), warnings: ["Missing proposed content; nothing was validated."], action: retryContentAction() });
    }
    if (typeof request.content !== "string") {
      return emptyValidationOutput({ status: "validation_error", target: target.value, checkedScope: "proposed_content", expectedPath: expectedPath.path, error: validationError("CONTENT_NOT_STRING", "validation", "Provide content as a Markdown string for target=proposed_content."), warnings: ["Non-string proposed content refused; nothing was validated."], action: retryContentAction() });
    }
    if (request.content.trim() === "") {
      return emptyValidationOutput({ status: "validation_error", target: target.value, checkedScope: "proposed_content", expectedPath: expectedPath.path, error: validationError("EMPTY_CONTENT", "validation", "Provide non-empty Markdown content for target=proposed_content."), warnings: ["Empty proposed content refused; nothing was validated."], action: retryContentAction() });
    }
    const metadata = validateMarkdownContent(request.content, { expectedPath: expectedPath.path, budget, maxIssues: maxIssues.maxIssues, checkedScope: "proposed_content" });
    return {
      tool: "obsidian_validate",
      status: "success",
      target: target.value,
      ...(expectedPath.path ? { expectedPath: expectedPath.path } : {}),
      valid: metadata.valid,
      issueCount: metadata.issueCount,
      issues: metadata.issues,
      warnings: metadata.warnings,
      degradedSignals: metadata.degradedSignals,
      summary: metadata.summary,
      nextActions: nextActionsForSummary(metadata.summary.errorCount, metadata.summary.warningCount, metadata.summary.infoCount),
    };
  }

  const safePath = normalizeValidationNotePath(request.path);
  if (!safePath.ok) {
    return emptyValidationOutput({ status: safePath.status, target: target.value, checkedScope: "existing_note", error: safePath.error, warnings: [safePath.warning], action: safePath.status === "safety_refusal" ? stopAction() : retryPathAction() });
  }

  if (!backend || (options.setupErrors?.length ?? 0) > 0) {
    return setupRequiredValidationResponse(request, [...(options.setupErrors ?? ["Obsidian validation requires configured read-only note access."])], options.setupWarnings ?? [], safePath.path);
  }

  try {
    const read = await backend.read({ path: safePath.path });
    const metadata = validateMarkdownContent(read.content, { expectedPath: expectedPath.path ?? safePath.path, budget, maxIssues: maxIssues.maxIssues, checkedScope: "existing_note" });
    return {
      tool: "obsidian_validate",
      status: "success",
      target: target.value,
      path: safePath.path,
      ...(expectedPath.path ? { expectedPath: expectedPath.path } : {}),
      valid: metadata.valid,
      issueCount: metadata.issueCount,
      issues: metadata.issues.map((item) => ({ ...item, path: item.path ?? safePath.path })),
      warnings: metadata.warnings,
      degradedSignals: metadata.degradedSignals,
      summary: metadata.summary,
      nextActions: nextActionsForSummary(metadata.summary.errorCount, metadata.summary.warningCount, metadata.summary.infoCount),
    };
  } catch {
    return emptyValidationOutput({ status: "not_found", target: target.value, checkedScope: "existing_note", path: safePath.path, expectedPath: expectedPath.path, error: validationError("NOTE_NOT_FOUND", "not_found", "The requested Markdown note does not exist or is not readable."), warnings: ["The requested note was not found; no content was validated or inferred."], action: retryPathAction() });
  }
}

export function setupRequiredValidationResponse(request: ObsidianValidateRequest, errors: string[], warnings: string[] = [], path?: string | undefined): ObsidianValidateOutput {
  const target = request.target === "existing_note" || request.target === "proposed_content" ? request.target : undefined;
  return emptyValidationOutput({
    status: "setup_required",
    target,
    checkedScope: checkedScopeFor(target),
    path,
    error: validationError("OBSIDIAN_UNAVAILABLE", "setup", "Existing-note validation requires configured and reachable read-only Obsidian access."),
    warnings: [...errors.map(() => "Obsidian validation setup is incomplete; no note was read."), ...warnings.map(() => "Obsidian validation setup warning was reported without exposing local paths.")],
    action: { priority: 1, action: "configure_obsidian", label: "Configure Obsidian access before retrying existing-note validation." },
  });
}

function normalizeTarget(value: unknown): { ok: true; value: ValidationTarget } | { ok: false; value?: undefined; error: ValidationError; warning: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: false, error: validationError("MISSING_TARGET", "validation", "Provide target=existing_note or target=proposed_content."), warning: "Missing validation target; no content was validated." };
  }
  if (value === "existing_note" || value === "proposed_content") return { ok: true, value };
  return { ok: false, error: validationError("UNSUPPORTED_TARGET", "validation", "Supported validation targets are existing_note and proposed_content."), warning: "Unsupported validation target refused; no content was validated." };
}

function emptyValidationOutput(input: {
  status: ValidationStatus;
  target?: ValidationTarget | undefined;
  checkedScope: ValidationCheckedScope;
  path?: string | undefined;
  expectedPath?: string | undefined;
  error: ValidationError;
  warnings: string[];
  action: ValidationNextAction;
}): ObsidianValidateOutput {
  return {
    tool: "obsidian_validate",
    status: input.status,
    ...(input.target ? { target: input.target } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.expectedPath ? { expectedPath: input.expectedPath } : {}),
    valid: false,
    issueCount: 0,
    issues: [],
    warnings: [...new Set(input.warnings)].sort((a, b) => a.localeCompare(b)),
    degradedSignals: [],
    summary: { valid: false, errorCount: 0, warningCount: 0, infoCount: 0, returnedIssueCount: 0, omittedIssueCount: 0, highestSeverity: "none", workflowNeutral: true, checkedScope: input.checkedScope },
    nextActions: [input.action],
    error: input.error,
  };
}

function checkedScopeFor(target: ValidationTarget | undefined): ValidationCheckedScope {
  return target === "existing_note" ? "existing_note" : "proposed_content";
}

function retryActionFor(target: ValidationTarget | undefined): ValidationNextAction {
  return target === "existing_note" ? retryPathAction() : retryContentAction();
}

function retryPathAction(): ValidationNextAction {
  return { priority: 1, action: "retry_with_safe_path", label: "Retry only after the user provides an existing safe vault-relative Markdown path." };
}

function retryContentAction(): ValidationNextAction {
  return { priority: 1, action: "retry_with_content", label: "Retry with explicit non-empty Markdown content." };
}

function stopAction(): ValidationNextAction {
  return { priority: 1, action: "stop", label: "Do not retry until the request uses one explicit safe vault-relative Markdown path." };
}

function nextActionsForSummary(errorCount: number, warningCount: number, infoCount: number): ValidationNextAction[] {
  if (errorCount > 0) return [{ priority: 1, action: "fix_errors", label: "Fix error-severity validation issues before asking to commit content." }];
  if (warningCount > 0 || infoCount > 0) return [{ priority: 1, action: "review_warnings", label: "Review warning and info issues as advisory guidance; they do not block user workflow." }];
  return [{ priority: 1, action: "proceed_if_user_confirms", label: "Validation found no issues; proceed only if the user confirms the intended workflow." }];
}
