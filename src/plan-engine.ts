import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { planExactTextTransform } from "./exact-text-editor.js";
import { planRemoveFrontmatter, planUpdateFrontmatter } from "./frontmatter-editor.js";
import { planSectionTransform } from "./markdown-section-editor.js";
import { validateMarkdownContent } from "./note-validation.js";
import { normalizeCopyDestinationPath, normalizeCopySourcePath, normalizeExplicitMarkdownNotePath, normalizeRestoreDestinationPath, normalizeRestoreSourcePath, normalizeTrashFolderTarget, normalizeTrashSourcePath, normalizeVaultFolderTarget } from "./path-safety.js";
import { PLAN_MAX_OPERATIONS, type ObsidianPlanOutput, type ObsidianPlanRequest, type PlanConflict, type PlanInspector, type PlanIssue, type PlanIssueCode, type PlannedEffects, type PlannedOperation, type PlanPathState } from "./plan-types.js";

const DEFAULT_TRASH_FOLDER = "_Trash";
const MUTATION_TOOLS = new Set(["write", "edit", "manage"]);
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

export interface ObsidianPlanOptions {
  vaultRoot?: string | undefined;
  inspector?: PlanInspector | undefined;
}

interface VirtualNote {
  exists: boolean;
  content?: string | undefined;
}

interface PlanState {
  notes: Map<string, VirtualNote>;
  folders: Set<string>;
  movedFrom: Map<string, { toPath: string; operationIndex: number; operationId?: string | undefined }>;
  trashed: Map<string, { trashPath: string; operationIndex: number; operationId?: string | undefined }>;
  destinations: Map<string, { operationIndex: number; operationId?: string | undefined }>;
  issues: PlanIssue[];
  conflicts: PlanConflict[];
  warnings: string[];
  degradedSignals: string[];
  effects: PlannedEffects;
  wouldMutate: boolean;
}

interface NormalizedOperation {
  tool: "retrieve" | "validate" | "write" | "edit" | "manage";
  operation: string;
  id?: string | undefined;
}

export async function obsidianPlan(request: ObsidianPlanRequest, options: ObsidianPlanOptions = {}): Promise<ObsidianPlanOutput> {
  const requestValidation = validateRequest(request);
  if (!requestValidation.ok) return planOutput("validation_error", 0, requestValidation.issues, emptyEffects(), [], [], []);

  const inspector = options.inspector ?? (options.vaultRoot ? new LocalPlanInspector(options.vaultRoot) : undefined);
  const state = emptyState();
  const seenIds = new Map<string, number>();

  for (let index = 0; index < requestValidation.operations.length; index += 1) {
    const raw = requestValidation.operations[index];
    if (!isRecord(raw)) {
      addIssue(state, { code: "OPERATION_NOT_OBJECT", severity: "error", message: "Each planned operation must be an object.", operationIndex: index });
      continue;
    }
    const op = raw as PlannedOperation;
    const operationId = normalizeId(op.id);
    if (operationId) {
      const previous = seenIds.get(operationId);
      if (previous !== undefined) addIssue(state, { code: "DUPLICATE_OPERATION_ID", severity: "error", message: "Planned operation ids must be unique within the plan.", operationIndex: index, operationId, relatedOperationIndex: previous });
      else seenIds.set(operationId, index);
    }

    const normalized = normalizeOperation(op, index, operationId, state);
    if (!normalized) continue;
    if (op.dryRun === false) addIssue(state, { code: "DRY_RUN_FALSE_IGNORED", severity: "warning", message: "dryRun:false is ignored by obsidian_plan; no operation is committed.", operationIndex: index, operationId });
    if (MUTATION_TOOLS.has(normalized.tool)) state.wouldMutate = true;

    await evaluateOperation(normalized, op, index, state, inspector);
  }

  const issues = sortIssues(state.issues);
  const conflicts = sortConflicts(state.conflicts);
  const warnings = sortStrings([...state.warnings, ...issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message)]);
  return planOutput("success", requestValidation.operations.length, issues, finalizeEffects(state.effects), conflicts, warnings, sortStrings(state.degradedSignals), state.wouldMutate);
}

function validateRequest(request: ObsidianPlanRequest): { ok: true; operations: unknown[] } | { ok: false; issues: PlanIssue[] } {
  if (!Object.prototype.hasOwnProperty.call(request, "operations")) return { ok: false, issues: [{ code: "MISSING_OPERATIONS", severity: "error", message: "Provide a non-empty operations array." }] };
  if (!Array.isArray(request.operations)) return { ok: false, issues: [{ code: "OPERATIONS_NOT_ARRAY", severity: "error", message: "operations must be an array." }] };
  if (request.operations.length === 0) return { ok: false, issues: [{ code: "EMPTY_OPERATIONS", severity: "error", message: "Provide at least one planned operation." }] };
  if (request.maxOperations !== undefined && (!Number.isInteger(request.maxOperations) || request.maxOperations < 1 || request.maxOperations > PLAN_MAX_OPERATIONS)) return { ok: false, issues: [{ code: "INVALID_MAX_OPERATIONS", severity: "error", message: `maxOperations must be an integer from 1 to ${PLAN_MAX_OPERATIONS}.` }] };
  const acceptedLimit = request.maxOperations ?? PLAN_MAX_OPERATIONS;
  if (request.operations.length > acceptedLimit) return { ok: false, issues: [{ code: "TOO_MANY_OPERATIONS", severity: "error", message: "The plan contains too many operations and was refused instead of truncated." }] };
  return { ok: true, operations: request.operations };
}

function normalizeOperation(op: PlannedOperation, operationIndex: number, operationId: string | undefined, state: PlanState): NormalizedOperation | undefined {
  if (!op.operation?.trim()) {
    addIssue(state, { code: "MISSING_OPERATION", severity: "error", message: "Each planned operation requires an operation name.", operationIndex, operationId });
    return undefined;
  }
  const tool = normalizeTool(op.tool);
  const category = normalizeTool(op.category);
  if (!tool && !category) {
    const suppliedTool = typeof op.tool === "string" && op.tool.trim();
    const suppliedCategory = typeof op.category === "string" && op.category.trim();
    addIssue(state, { code: suppliedTool || suppliedCategory ? "UNSUPPORTED_TOOL" : "MISSING_TOOL_OR_CATEGORY", severity: "error", message: suppliedTool || suppliedCategory ? "Unsupported public tool or category." : "Each planned operation requires a supported tool or category.", operationIndex, operationId });
    return undefined;
  }
  if (tool && category && tool !== category) {
    addIssue(state, { code: "TOOL_CATEGORY_MISMATCH", severity: "error", message: "tool and category must refer to the same public surface.", operationIndex, operationId });
    return undefined;
  }
  const resolvedTool = tool ?? category;
  if (!resolvedTool) {
    addIssue(state, { code: "UNSUPPORTED_TOOL", severity: "error", message: "Unsupported public tool or category.", operationIndex, operationId });
    return undefined;
  }
  const operation = op.operation.trim();
  if (isForbiddenOperation(operation)) {
    addIssue(state, { code: "FORBIDDEN_OPERATION", severity: "error", message: "Forbidden batch, commit, rewrite, shell, network, scan, UI, or destructive operation refused.", operationIndex, operationId });
    return undefined;
  }
  if (!isSupportedOperation(resolvedTool, operation)) {
    addIssue(state, { code: "UNSUPPORTED_OPERATION", severity: "error", message: "Unsupported operation for this public tool surface.", operationIndex, operationId });
    return undefined;
  }
  return { tool: resolvedTool, operation, id: operationId };
}

async function evaluateOperation(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  if (normalized.tool === "retrieve") return evaluateRetrieve(normalized, op, index, state, inspector);
  if (normalized.tool === "validate") return evaluateValidate(normalized, op, index, state, inspector);
  if (normalized.tool === "write") return evaluateWrite(normalized, op, index, state, inspector);
  if (normalized.tool === "edit") return evaluateEdit(normalized, op, index, state, inspector);
  return evaluateManage(normalized, op, index, state, inspector);
}

async function evaluateRetrieve(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  const pathResult = normalizePathField(op.path, normalized.operation === "relationships" ? "MISSING_PATH" : "MISSING_PATH", "UNSAFE_PATH", "NOTE_NOT_MARKDOWN");
  if (!pathResult.ok) return addIssue(state, issueForPath(pathResult, index, normalized.id));
  if (orderingIssueForRead(pathResult.path, normalized.operation, index, normalized.id, state)) return;
  await requireNote(pathResult.path, index, normalized.id, state, inspector, "TARGET_MISSING", false);
  addUnique(state.effects.notesReadOrValidated, pathResult.path);
  addAffected(state, pathResult.path);
}

async function evaluateValidate(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  if (normalized.operation === "proposed_content") {
    if (typeof op.content !== "string") return addIssue(state, { code: "MISSING_CONTENT", severity: "error", message: "validate.proposed_content requires content.", operationIndex: index, operationId: normalized.id });
    if (op.content.trim() === "") return addIssue(state, { code: "EMPTY_CONTENT", severity: "error", message: "validate.proposed_content requires non-empty content.", operationIndex: index, operationId: normalized.id });
    if (op.expectedPath !== undefined) {
      const expected = normalizePathField(op.expectedPath, "MISSING_PATH", "UNSAFE_EXPECTED_PATH", "NOTE_NOT_MARKDOWN");
      if (!expected.ok) addIssue(state, { ...issueForPath(expected, index, normalized.id), code: expected.code === "UNSAFE_PATH" ? "UNSAFE_EXPECTED_PATH" : expected.code });
    }
    validateMarkdownContent(op.content);
    return;
  }
  const pathResult = normalizePathField(op.path, "MISSING_PATH", "UNSAFE_PATH", "NOTE_NOT_MARKDOWN");
  if (!pathResult.ok) return addIssue(state, issueForPath(pathResult, index, normalized.id));
  if (orderingIssueForRead(pathResult.path, normalized.operation, index, normalized.id, state)) return;
  await requireNote(pathResult.path, index, normalized.id, state, inspector, "TARGET_MISSING", false);
  addUnique(state.effects.notesReadOrValidated, pathResult.path);
  addAffected(state, pathResult.path);
}

async function evaluateWrite(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  if (normalized.operation === "create_folder") {
    if (op.content !== undefined) addIssue(state, { code: "CONTENT_NOT_ALLOWED", severity: "error", message: "write.create_folder does not accept content.", operationIndex: index, operationId: normalized.id });
    const folder = normalizeFolderField(op.path, "MISSING_PATH", "UNSAFE_PATH");
    if (!folder.ok) return addIssue(state, issueForPath(folder, index, normalized.id));
    await ensureFolderTargetAvailable(folder.path, index, normalized.id, state, inspector);
    registerDestination(folder.path, index, normalized.id, state);
    addUnique(state.effects.foldersCreated, folder.path);
    state.folders.add(folder.path);
    addAffected(state, folder.path);
    return;
  }

  const pathResult = normalizePathField(op.path, "MISSING_PATH", "UNSAFE_PATH", "TARGET_NOT_MARKDOWN");
  if (!pathResult.ok) return addIssue(state, issueForPath(pathResult, index, normalized.id));
  if (typeof op.content !== "string") addIssue(state, { code: "MISSING_CONTENT", severity: "error", message: `write.${normalized.operation} requires content.`, operationIndex: index, operationId: normalized.id, path: pathResult.path });
  else if (op.content.trim() === "") addIssue(state, { code: "EMPTY_CONTENT", severity: "error", message: `write.${normalized.operation} requires non-empty content.`, operationIndex: index, operationId: normalized.id, path: pathResult.path });
  if (normalized.operation === "create") {
    await ensureTargetMissing(pathResult.path, index, normalized.id, state, inspector);
    await reportCreateParents(pathResult.path, index, normalized.id, state, inspector);
    registerDestination(pathResult.path, index, normalized.id, state);
    addUnique(state.effects.notesCreated, pathResult.path);
    state.notes.set(pathResult.path, { exists: true, content: typeof op.content === "string" ? op.content : "" });
  } else {
    if (orderingIssueForWrite(pathResult.path, "append", index, normalized.id, state)) return;
    await requireNote(pathResult.path, index, normalized.id, state, inspector, "TARGET_MISSING", true);
    addUnique(state.effects.notesAppended, pathResult.path);
    const existing = state.notes.get(pathResult.path);
    if (existing) existing.content = `${existing.content ?? ""}${typeof op.content === "string" ? op.content : ""}`;
  }
  addAffected(state, pathResult.path);
}

async function evaluateEdit(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  const pathResult = normalizePathField(op.path, "MISSING_PATH", "UNSAFE_PATH", "NOTE_NOT_MARKDOWN");
  if (!pathResult.ok) return addIssue(state, issueForPath(pathResult, index, normalized.id));
  if (orderingIssueForWrite(pathResult.path, "edit", index, normalized.id, state)) return;
  validateEditFields(normalized.operation, op, index, normalized.id, pathResult.path, state);
  const content = await requireNote(pathResult.path, index, normalized.id, state, inspector, "TARGET_MISSING", true);
  if (content !== undefined && !state.issues.some((issue) => issue.operationIndex === index && issue.severity === "error")) {
    try {
      const transformed = transformEdit(normalized.operation, op, content);
      state.notes.set(pathResult.path, { exists: true, content: transformed });
    } catch {
      addIssue(state, { code: "CHECK_UNAVAILABLE", severity: "warning", message: "Edit transform could not be fully previewed from bounded state; no mutation was attempted.", operationIndex: index, operationId: normalized.id, path: pathResult.path });
      state.degradedSignals.push("edit_transform_unavailable");
    }
  }
  addUnique(state.effects.notesEdited, pathResult.path);
  addAffected(state, pathResult.path);
}

async function evaluateManage(normalized: NormalizedOperation, op: PlannedOperation, index: number, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  if (normalized.operation === "move_note" || normalized.operation === "copy_note") {
    const from = normalizePathField(op.fromPath, "MISSING_FROM_PATH", "UNSAFE_FROM_PATH", "NOTE_NOT_MARKDOWN", normalized.operation === "copy_note" ? normalizeCopySourcePath : undefined);
    if (!from.ok) return addIssue(state, issueForPath(from, index, normalized.id));
    const to = normalizePathField(op.toPath, "MISSING_TO_PATH", "UNSAFE_TO_PATH", "TARGET_NOT_MARKDOWN", normalized.operation === "copy_note" ? normalizeCopyDestinationPath : undefined);
    if (!to.ok) return addIssue(state, issueForPath(to, index, normalized.id));
    if (from.path === to.path) addIssue(state, { code: "SAME_PATH", severity: "error", message: "Source and destination paths must differ.", operationIndex: index, operationId: normalized.id, fromPath: from.path, toPath: to.path });
    if (orderingIssueForRead(from.path, normalized.operation, index, normalized.id, state)) return;
    const content = await requireNote(from.path, index, normalized.id, state, inspector, "SOURCE_NOT_FOUND", true);
    await ensureTargetMissing(to.path, index, normalized.id, state, inspector);
    await requireExistingParent(to.path, index, normalized.id, state, inspector);
    registerDestination(to.path, index, normalized.id, state);
    if (normalized.operation === "move_note") {
      state.notes.set(from.path, { exists: false });
      state.notes.set(to.path, { exists: true, content });
      state.movedFrom.set(from.path, { toPath: to.path, operationIndex: index, operationId: normalized.id });
      state.effects.notesMoved.push({ fromPath: from.path, toPath: to.path });
    } else {
      state.notes.set(to.path, { exists: true, content });
      state.effects.notesCopied.push({ fromPath: from.path, toPath: to.path });
    }
    addAffected(state, from.path, to.path);
    return;
  }

  if (normalized.operation === "trash_note") {
    const source = normalizePathField(op.path, "MISSING_PATH", "UNSAFE_PATH", "NOTE_NOT_MARKDOWN", normalizeTrashSourcePath);
    if (!source.ok) return addIssue(state, issueForPath(source, index, normalized.id));
    const trashFolder = normalizeFolderField(op.trashFolder ?? DEFAULT_TRASH_FOLDER, "MISSING_PATH", "UNSAFE_TRASH_FOLDER", normalizeTrashFolderTarget);
    if (!trashFolder.ok) return addIssue(state, issueForPath(trashFolder, index, normalized.id));
    const trashPath = `${trashFolder.path}/${source.path.split("/").at(-1) ?? source.path}`;
    if (orderingIssueForWrite(source.path, "trash", index, normalized.id, state)) return;
    const content = await requireNote(source.path, index, normalized.id, state, inspector, "SOURCE_NOT_FOUND", true);
    await ensureTargetMissing(trashPath, index, normalized.id, state, inspector, "TRASH_TARGET_EXISTS");
    registerDestination(trashPath, index, normalized.id, state);
    await ensureFolderKnownOrPlanned(trashFolder.path, state, inspector, index, normalized.id);
    state.notes.set(source.path, { exists: false });
    state.notes.set(trashPath, { exists: true, content });
    state.trashed.set(source.path, { trashPath, operationIndex: index, operationId: normalized.id });
    state.effects.notesTrashed.push({ path: source.path, trashPath });
    addAffected(state, source.path, trashPath);
    return;
  }

  const trashPathResult = normalizePathField(op.trashPath, "MISSING_TRASH_PATH", "UNSAFE_TRASH_PATH", "NOTE_NOT_MARKDOWN", normalizeRestoreSourcePath);
  if (!trashPathResult.ok) return addIssue(state, issueForPath(trashPathResult, index, normalized.id));
  const to = normalizePathField(op.toPath, "MISSING_TO_PATH", "UNSAFE_TO_PATH", "TARGET_NOT_MARKDOWN", normalizeRestoreDestinationPath);
  if (!to.ok) return addIssue(state, issueForPath(to, index, normalized.id));
  const trashFolder = normalizeFolderField(op.trashFolder ?? DEFAULT_TRASH_FOLDER, "MISSING_PATH", "UNSAFE_TRASH_FOLDER", normalizeTrashFolderTarget);
  if (!trashFolder.ok) return addIssue(state, issueForPath(trashFolder, index, normalized.id));
  if (!isInsideFolder(trashPathResult.path, trashFolder.path)) addIssue(state, { code: "TRASH_PATH_OUTSIDE_TRASH", severity: "error", message: "trashPath must be inside the selected trashFolder.", operationIndex: index, operationId: normalized.id, trashPath: trashPathResult.path, trashFolder: trashFolder.path });
  const content = await requireNote(trashPathResult.path, index, normalized.id, state, inspector, "SOURCE_NOT_FOUND", true);
  await ensureTargetMissing(to.path, index, normalized.id, state, inspector);
  await requireExistingParent(to.path, index, normalized.id, state, inspector);
  registerDestination(to.path, index, normalized.id, state);
  state.notes.set(trashPathResult.path, { exists: false });
  state.notes.set(to.path, { exists: true, content });
  state.effects.notesRestored.push({ trashPath: trashPathResult.path, toPath: to.path });
  addAffected(state, trashPathResult.path, to.path);
}

function validateEditFields(operation: string, op: PlannedOperation, index: number, operationId: string | undefined, safePath: string, state: PlanState): void {
  if (operation === "replace_section" || operation === "insert_under_heading") {
    if (!op.heading?.trim()) addIssue(state, { code: "MISSING_HEADING", severity: "error", message: "Section edit operations require heading.", operationIndex: index, operationId, path: safePath });
    if (typeof op.content !== "string") addIssue(state, { code: "MISSING_CONTENT", severity: "error", message: "Section edit operations require content.", operationIndex: index, operationId, path: safePath });
    else if (operation === "insert_under_heading" && op.content.trim() === "") addIssue(state, { code: "EMPTY_CONTENT", severity: "error", message: "insert_under_heading requires non-empty content.", operationIndex: index, operationId, path: safePath });
    return;
  }
  if (operation === "replace_exact_text") {
    if (typeof op.oldText !== "string" || op.oldText.length === 0) addIssue(state, { code: "MISSING_OLD_TEXT", severity: "error", message: "replace_exact_text requires non-empty oldText.", operationIndex: index, operationId, path: safePath });
    if (!Object.prototype.hasOwnProperty.call(op, "newText") || typeof op.newText !== "string") addIssue(state, { code: "MISSING_NEW_TEXT", severity: "error", message: "replace_exact_text requires explicit newText.", operationIndex: index, operationId, path: safePath });
    return;
  }
  if (!op.property?.trim()) addIssue(state, { code: "MISSING_PROPERTY", severity: "error", message: "Frontmatter operations require property.", operationIndex: index, operationId, path: safePath });
  if (operation === "update_frontmatter" && !Object.prototype.hasOwnProperty.call(op, "value")) addIssue(state, { code: "MISSING_VALUE", severity: "error", message: "update_frontmatter requires value.", operationIndex: index, operationId, path: safePath });
}

function transformEdit(operation: string, op: PlannedOperation, content: string): string {
  if (operation === "replace_section" || operation === "insert_under_heading") return planSectionTransform(content, operation, op.heading!, op.content ?? "").contentAfter;
  if (operation === "update_frontmatter") return planUpdateFrontmatter(content, op.property!, op.value).contentAfter;
  if (operation === "remove_frontmatter") return planRemoveFrontmatter(content, op.property!).contentAfter;
  return planExactTextTransform(content, op.oldText!, op.newText!).contentAfter;
}

async function requireNote(safePath: string, index: number, operationId: string | undefined, state: PlanState, inspector: PlanInspector | undefined, missingCode: PlanIssueCode, readContent: boolean): Promise<string | undefined> {
  const virtual = state.notes.get(safePath);
  if (virtual) {
    if (!virtual.exists) addIssue(state, { code: missingCode, severity: "error", message: "Required source or target note is missing in the virtual plan state.", operationIndex: index, operationId, path: safePath });
    return virtual.content;
  }
  if (!inspector) {
    addIssue(state, { code: "CHECK_UNAVAILABLE", severity: "warning", message: "Targeted note state check unavailable; no broad scan was performed.", operationIndex: index, operationId, path: safePath });
    state.degradedSignals.push("state_check_unavailable");
    return undefined;
  }
  try {
    const info = await inspector.noteState(safePath, readContent);
    if (!info.exists || !info.isFile) addIssue(state, { code: missingCode, severity: "error", message: "Required source or target note does not exist.", operationIndex: index, operationId, path: safePath });
    else state.notes.set(safePath, { exists: true, content: info.content });
    return info.content;
  } catch {
    addIssue(state, { code: "CHECK_UNAVAILABLE", severity: "warning", message: "Targeted note state check failed safely; no broad scan was performed.", operationIndex: index, operationId, path: safePath });
    state.degradedSignals.push("state_check_unavailable");
    return undefined;
  }
}

async function ensureTargetMissing(safePath: string, index: number, operationId: string | undefined, state: PlanState, inspector: PlanInspector | undefined, code: PlanIssueCode = "TARGET_EXISTS"): Promise<void> {
  const virtual = state.notes.get(safePath);
  if (virtual?.exists) addIssue(state, { code, severity: "error", message: "Destination already exists in the virtual plan state.", operationIndex: index, operationId, path: safePath });
  if (!inspector || virtual) return;
  const info = await safeStateCheck(() => inspector.noteState(safePath, false), state, index, operationId, safePath);
  if (info?.exists) addIssue(state, { code, severity: "error", message: "Destination already exists; overwrite is not supported.", operationIndex: index, operationId, path: safePath });
}

async function ensureFolderTargetAvailable(safePath: string, index: number, operationId: string | undefined, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  if (state.folders.has(safePath)) addIssue(state, { code: "TARGET_EXISTS", severity: "error", message: "Folder destination already exists in virtual plan state.", operationIndex: index, operationId, path: safePath });
  if (!inspector) return;
  const info = await safeStateCheck(() => inspector.folderState(safePath), state, index, operationId, safePath);
  if (info?.exists) addIssue(state, { code: "TARGET_EXISTS", severity: "error", message: "Folder target already exists.", operationIndex: index, operationId, path: safePath });
}

async function requireExistingParent(safePath: string, index: number, operationId: string | undefined, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  const parent = parentFolder(safePath);
  if (parent === "" || state.folders.has(parent)) return;
  if (!inspector) {
    addIssue(state, { code: "CHECK_UNAVAILABLE", severity: "warning", message: "Destination parent check unavailable; no broad scan was performed.", operationIndex: index, operationId, path: safePath });
    state.degradedSignals.push("state_check_unavailable");
    return;
  }
  const info = await safeStateCheck(() => inspector.folderState(parent), state, index, operationId, safePath);
  if (!info) return;
  if (!info.exists) addIssue(state, { code: "PARENT_MISSING", severity: "error", message: "Destination parent folder is missing.", operationIndex: index, operationId, path: safePath });
  else if (!info.isDirectory) addIssue(state, { code: "PARENT_NOT_FOLDER", severity: "error", message: "Destination parent exists but is not a folder.", operationIndex: index, operationId, path: safePath });
}

async function reportCreateParents(safePath: string, index: number, operationId: string | undefined, state: PlanState, inspector: PlanInspector | undefined): Promise<void> {
  const parent = parentFolder(safePath);
  if (!parent || state.folders.has(parent)) return;
  if (!inspector) return;
  const info = await safeStateCheck(() => inspector.folderState(parent), state, index, operationId, safePath);
  if (info?.exists && !info.isDirectory) addIssue(state, { code: "PARENT_NOT_FOLDER", severity: "error", message: "A non-folder entry blocks the target parent path.", operationIndex: index, operationId, path: safePath });
  if (!info?.exists) {
    const segments = parent.split("/");
    for (let i = 1; i <= segments.length; i += 1) {
      const folder = segments.slice(0, i).join("/");
      addUnique(state.effects.foldersCreated, folder);
      state.folders.add(folder);
    }
  }
}

async function ensureFolderKnownOrPlanned(folder: string, state: PlanState, inspector: PlanInspector | undefined, index: number, operationId: string | undefined): Promise<void> {
  if (state.folders.has(folder)) return;
  if (!inspector) {
    addUnique(state.effects.foldersCreated, folder);
    state.folders.add(folder);
    return;
  }
  const info = await safeStateCheck(() => inspector.folderState(folder), state, index, operationId, folder);
  if (!info?.exists) {
    addUnique(state.effects.foldersCreated, folder);
    state.folders.add(folder);
  } else if (!info.isDirectory) addIssue(state, { code: "PARENT_NOT_FOLDER", severity: "error", message: "Trash folder exists but is not a folder.", operationIndex: index, operationId, trashFolder: folder });
}

async function safeStateCheck(run: () => Promise<PlanPathState>, state: PlanState, operationIndex: number, operationId: string | undefined, safePath: string): Promise<PlanPathState | undefined> {
  try {
    return await run();
  } catch {
    addIssue(state, { code: "CHECK_UNAVAILABLE", severity: "warning", message: "Targeted state check failed safely; no broad scan was performed.", operationIndex, operationId, path: safePath });
    state.degradedSignals.push("state_check_unavailable");
    return undefined;
  }
}

function orderingIssueForRead(safePath: string, operation: string, index: number, operationId: string | undefined, state: PlanState): boolean {
  const moved = state.movedFrom.get(safePath);
  if (moved) {
    addIssue(state, { code: "READ_AFTER_MOVE_OLD_PATH", severity: "error", message: "This operation reads from a path moved earlier in the plan.", operationIndex: index, operationId, relatedOperationIndex: moved.operationIndex, relatedOperationId: moved.operationId, path: safePath });
    return true;
  }
  const trashed = state.trashed.get(safePath);
  if (trashed) {
    addIssue(state, { code: operation.includes("edit") ? "EDIT_AFTER_TRASH" : "WRITE_AFTER_TRASH", severity: "error", message: "This operation uses a path trashed earlier in the plan.", operationIndex: index, operationId, relatedOperationIndex: trashed.operationIndex, relatedOperationId: trashed.operationId, path: safePath });
    return true;
  }
  return false;
}

function orderingIssueForWrite(safePath: string, kind: "append" | "edit" | "trash", index: number, operationId: string | undefined, state: PlanState): boolean {
  const moved = state.movedFrom.get(safePath);
  if (moved) {
    addIssue(state, { code: kind === "append" ? "APPEND_AFTER_MOVE_OLD_PATH" : "READ_AFTER_MOVE_OLD_PATH", severity: "error", message: "This operation uses a path that an earlier planned operation moved away from.", operationIndex: index, operationId, relatedOperationIndex: moved.operationIndex, relatedOperationId: moved.operationId, path: safePath });
    return true;
  }
  const trashed = state.trashed.get(safePath);
  if (trashed) {
    addIssue(state, { code: kind === "edit" ? "EDIT_AFTER_TRASH" : "WRITE_AFTER_TRASH", severity: "error", message: "This operation writes to a path trashed earlier in the plan.", operationIndex: index, operationId, relatedOperationIndex: trashed.operationIndex, relatedOperationId: trashed.operationId, path: safePath });
    return true;
  }
  return false;
}

function registerDestination(pathValue: string, operationIndex: number, operationId: string | undefined, state: PlanState): void {
  const existing = state.destinations.get(pathValue);
  if (existing) addIssue(state, { code: "DUPLICATE_DESTINATION", severity: "error", message: "Two planned operations target the same destination path.", operationIndex, operationId, relatedOperationIndex: existing.operationIndex, relatedOperationId: existing.operationId, path: pathValue }, true);
  else state.destinations.set(pathValue, { operationIndex, operationId });
}

function addIssue(state: PlanState, issue: PlanIssue, conflict = false): void {
  state.issues.push(issue);
  if (conflict || issue.code.includes("DUPLICATE") || issue.code.includes("AFTER") || issue.code === "TARGET_EXISTS" || issue.code === "PARENT_MISSING" || issue.code === "PARENT_NOT_FOLDER" || issue.code === "SOURCE_NOT_FOUND" || issue.code === "TRASH_TARGET_EXISTS") {
    if (issue.severity === "error" || issue.severity === "warning") {
      const conflictItem: PlanConflict = { code: issue.code, severity: issue.severity, operationIndex: issue.operationIndex ?? -1 };
      if (issue.operationId) conflictItem.operationId = issue.operationId;
      if (issue.relatedOperationIndex !== undefined) conflictItem.relatedOperationIndex = issue.relatedOperationIndex;
      if (issue.relatedOperationId) conflictItem.relatedOperationId = issue.relatedOperationId;
      if (issue.path) conflictItem.path = issue.path;
      if (issue.fromPath) conflictItem.fromPath = issue.fromPath;
      if (issue.toPath) conflictItem.toPath = issue.toPath;
      if (issue.trashPath) conflictItem.trashPath = issue.trashPath;
      if (issue.trashFolder) conflictItem.trashFolder = issue.trashFolder;
      state.conflicts.push(conflictItem);
    }
  }
}

function normalizeTool(value: unknown): NormalizedOperation["tool"] | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  if (key === "obsidian_retrieve" || key === "retrieve") return "retrieve";
  if (key === "obsidian_validate" || key === "validate") return "validate";
  if (key === "obsidian_write" || key === "write") return "write";
  if (key === "obsidian_edit" || key === "edit") return "edit";
  if (key === "obsidian_manage" || key === "manage") return "manage";
  return undefined;
}

function isSupportedOperation(tool: NormalizedOperation["tool"], operation: string): boolean {
  const allowed: Record<NormalizedOperation["tool"], string[]> = {
    retrieve: ["note", "relationships"],
    validate: ["existing_note", "proposed_content"],
    write: ["create", "append", "create_folder"],
    edit: ["replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text"],
    manage: ["move_note", "trash_note", "restore_note", "copy_note"],
  };
  return allowed[tool].includes(operation);
}

function isForbiddenOperation(value: string): boolean {
  return /commit|token|batch|transaction|execute|apply|rewrite|delete|overwrite|open|shell|network|scan|wildcard|recursive|folder_(?:move|copy|delete)|move_folder|copy_folder|delete_folder/i.test(value);
}

function normalizeId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePathField(value: unknown, missingCode: PlanIssueCode, unsafeCode: PlanIssueCode, nonMarkdownCode: PlanIssueCode, normalizer: (input: string) => string = normalizeExplicitMarkdownNotePath): { ok: true; path: string } | { ok: false; code: PlanIssueCode; message: string } {
  if (typeof value !== "string" || !value.trim()) return { ok: false, code: missingCode, message: "Provide one explicit safe vault-relative Markdown path." };
  try {
    return { ok: true, path: normalizer(value) };
  } catch (error) {
    if (error instanceof PathSafetyError && (error.code === "NON_MARKDOWN" || error.code === "EMPTY_PATH")) return { ok: false, code: nonMarkdownCode, message: "Provide an explicit safe Markdown .md path." };
    return { ok: false, code: unsafeCode, message: "Provide a safe vault-relative path without absolute, traversal, hidden, .obsidian, wildcard, recursive, or bulk syntax." };
  }
}

function normalizeFolderField(value: unknown, missingCode: PlanIssueCode, unsafeCode: PlanIssueCode, normalizer: (input: string) => string = normalizeVaultFolderTarget): { ok: true; path: string } | { ok: false; code: PlanIssueCode; message: string } {
  if (typeof value !== "string" || !value.trim()) return { ok: false, code: missingCode, message: "Provide one explicit safe vault-relative folder path." };
  try {
    return { ok: true, path: normalizer(value) };
  } catch {
    return { ok: false, code: unsafeCode, message: "Provide a safe vault-relative folder path without absolute, traversal, hidden, .obsidian, wildcard, recursive, extension-looking, or bulk syntax." };
  }
}

function issueForPath(input: { code: PlanIssueCode; message: string; path?: string }, operationIndex: number, operationId: string | undefined): PlanIssue {
  const issue: PlanIssue = { code: input.code, severity: "error", message: input.message, operationIndex };
  if (operationId) issue.operationId = operationId;
  if (input.path) issue.path = input.path;
  return issue;
}

function emptyState(): PlanState {
  return { notes: new Map(), folders: new Set(), movedFrom: new Map(), trashed: new Map(), destinations: new Map(), issues: [], conflicts: [], warnings: [], degradedSignals: [], effects: emptyEffects(), wouldMutate: false };
}

function emptyEffects(): PlannedEffects {
  return { notesCreated: [], notesAppended: [], notesEdited: [], foldersCreated: [], notesMoved: [], notesTrashed: [], notesRestored: [], notesCopied: [], notesReadOrValidated: [], affectedPaths: [] };
}

function finalizeEffects(effects: PlannedEffects): PlannedEffects {
  return {
    notesCreated: unique(effects.notesCreated),
    notesAppended: unique(effects.notesAppended),
    notesEdited: unique(effects.notesEdited),
    foldersCreated: unique(effects.foldersCreated),
    notesMoved: uniquePairs(effects.notesMoved, "fromPath", "toPath"),
    notesTrashed: uniquePairs(effects.notesTrashed, "path", "trashPath"),
    notesRestored: uniquePairs(effects.notesRestored, "trashPath", "toPath"),
    notesCopied: uniquePairs(effects.notesCopied, "fromPath", "toPath"),
    notesReadOrValidated: unique(effects.notesReadOrValidated),
    affectedPaths: unique(effects.affectedPaths).sort((a, b) => a.localeCompare(b)),
  };
}

function planOutput(status: ObsidianPlanOutput["status"], operationCount: number, issues: PlanIssue[], effects: PlannedEffects, conflicts: PlanConflict[], warnings: string[], degradedSignals: string[], wouldMutate = false): ObsidianPlanOutput {
  const sortedIssues = sortIssues(issues);
  const errorCount = sortedIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = sortedIssues.filter((issue) => issue.severity === "warning").length;
  const infoCount = sortedIssues.filter((issue) => issue.severity === "info").length;
  const valid = status === "success" && errorCount === 0;
  return {
    tool: "obsidian_plan",
    status,
    operationCount,
    valid,
    issues: sortedIssues,
    plannedEffects: effects,
    conflicts,
    warnings,
    degradedSignals,
    summary: { previewOnly: true, wouldMutateIfExecutedIndividually: wouldMutate, errorCount, warningCount, infoCount, conflictCount: conflicts.length, operationCount },
    nextActions: nextActions(valid, status, errorCount),
  };
}

function nextActions(valid: boolean, status: ObsidianPlanOutput["status"], errorCount: number) {
  if (status !== "success") return [{ priority: 1, action: "provide_operations" as const, label: "Provide a bounded non-empty operations array." }];
  if (!valid || errorCount > 0) return [{ priority: 1, action: "revise_plan" as const, label: "Revise the plan until error-severity issues are resolved; obsidian_plan cannot execute it." }];
  return [{ priority: 1, action: "run_individual_dry_runs" as const, label: "If the user wants to proceed, request each existing tool dry-run explicitly; obsidian_plan cannot commit." }];
}

function sortIssues(values: PlanIssue[]): PlanIssue[] {
  return [...values].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const op = (a.operationIndex ?? Number.MAX_SAFE_INTEGER) - (b.operationIndex ?? Number.MAX_SAFE_INTEGER);
    if (op !== 0) return op;
    const related = (a.relatedOperationIndex ?? Number.MAX_SAFE_INTEGER) - (b.relatedOperationIndex ?? Number.MAX_SAFE_INTEGER);
    if (related !== 0) return related;
    const code = a.code.localeCompare(b.code);
    if (code !== 0) return code;
    return a.message.localeCompare(b.message);
  });
}

function sortConflicts(values: PlanConflict[]): PlanConflict[] {
  return [...values].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const op = a.operationIndex - b.operationIndex;
    if (op !== 0) return op;
    const related = (a.relatedOperationIndex ?? Number.MAX_SAFE_INTEGER) - (b.relatedOperationIndex ?? Number.MAX_SAFE_INTEGER);
    if (related !== 0) return related;
    const code = a.code.localeCompare(b.code);
    if (code !== 0) return code;
    return (a.path ?? a.toPath ?? a.trashPath ?? "").localeCompare(b.path ?? b.toPath ?? b.trashPath ?? "");
  });
}

function sortStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function addAffected(state: PlanState, ...paths: string[]): void {
  for (const pathValue of paths) addUnique(state.effects.affectedPaths, pathValue);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniquePairs<T extends Record<string, string>>(values: T[], a: keyof T, b: keyof T): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const key = `${value[a]}→${value[b]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function parentFolder(safePath: string): string {
  const parent = path.posix.dirname(safePath);
  return parent === "." ? "" : parent;
}

function isInsideFolder(pathValue: string, folder: string): boolean {
  return pathValue === folder || pathValue.startsWith(`${folder.replace(/\/+$/g, "")}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class LocalPlanInspector implements PlanInspector {
  private rootRealpath: Promise<string> | undefined;

  constructor(private readonly root: string) {}

  async noteState(safePath: string, readContent = false): Promise<PlanPathState> {
    const absolutePath = await this.absoluteTargetPath(safePath);
    const info = await stat(absolutePath).catch(() => undefined);
    if (!info) return { exists: false, isFile: false, isDirectory: false };
    await this.assertRealPathContained(absolutePath);
    const result: PlanPathState = { exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
    if (readContent && info.isFile()) result.content = await readFile(absolutePath, "utf8");
    return result;
  }

  async folderState(safePath: string): Promise<PlanPathState> {
    if (!safePath) return { exists: true, isFile: false, isDirectory: true };
    const absolutePath = await this.absoluteTargetPath(safePath);
    const info = await stat(absolutePath).catch(() => undefined);
    if (!info) return { exists: false, isFile: false, isDirectory: false };
    await this.assertRealPathContained(absolutePath);
    return { exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() };
  }

  private async absoluteTargetPath(safePath: string): Promise<string> {
    const root = await this.vaultRootRealpath();
    const absolutePath = path.resolve(root, ...safePath.split("/").filter(Boolean));
    assertContained(root, absolutePath);
    return absolutePath;
  }

  private async vaultRootRealpath(): Promise<string> {
    this.rootRealpath ??= realpath(this.root).then(async (resolved) => {
      const info = await stat(resolved).catch(() => undefined);
      if (!info?.isDirectory()) throw new Error("Configured vault path is not a directory.");
      await access(resolved, fsConstants.R_OK).catch(() => {
        throw new Error("Configured vault path is not readable.");
      });
      return resolved;
    });
    return this.rootRealpath;
  }

  private async assertRealPathContained(inputPath: string): Promise<void> {
    const root = await this.vaultRootRealpath();
    const resolved = await realpath(inputPath).catch(() => undefined);
    if (resolved) assertContained(root, resolved);
  }
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error("Target path is outside the configured vault.");
}
