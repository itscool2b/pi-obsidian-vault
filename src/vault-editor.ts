import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { normalizeVaultRelativePath } from "./path-safety.js";
import { withTargetLock } from "./target-lock.js";
import type { EditTargetSummary, EditTransformResult } from "./edit-types.js";

export class VaultEditorSafetyError extends Error {
  constructor(message: string, public readonly code = "UNSAFE_PATH") {
    super(message);
    this.name = "VaultEditorSafetyError";
  }
}

export class VaultEditorSetupError extends Error {
  constructor(message: string, public readonly code: "VAULT_PATH_REQUIRED" | "VAULT_NOT_ACCESSIBLE" | "VAULT_NOT_WRITABLE") {
    super(message);
    this.name = "VaultEditorSetupError";
  }
}

export class VaultEditorTargetMissingError extends Error {
  constructor(message = "Target note does not exist; obsidian_edit will not create it.") {
    super(message);
    this.name = "VaultEditorTargetMissingError";
    this.code = "TARGET_MISSING" as const;
  }

  readonly code: "TARGET_MISSING";
}

export interface VaultEditInspection {
  target: EditTargetSummary;
  content: string;
}

export interface VaultEditResult {
  target: EditTargetSummary;
  transform: EditTransformResult;
}

export class LocalVaultEditor {
  private readonly root: string;
  private rootRealpath: Promise<string> | undefined;

  constructor(vaultRoot: string | undefined) {
    if (!vaultRoot) throw new VaultEditorSetupError("A local vault path is required for obsidian_edit.", "VAULT_PATH_REQUIRED");
    this.root = vaultRoot;
  }

  normalizePath(input: string): string {
    return normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
  }

  async preview(safePath: string, transform: (content: string) => EditTransformResult): Promise<VaultEditResult> {
    const inspected = await this.readExisting(safePath);
    const planned = transform(inspected.content);
    return { target: this.targetAfterTransform(inspected.target, planned), transform: planned };
  }

  async commit(safePath: string, transform: (content: string) => EditTransformResult): Promise<VaultEditResult> {
    return withTargetLock(`${await this.vaultRootRealpath()}::${safePath}`, async () => {
      const inspected = await this.readExisting(safePath);
      const planned = transform(inspected.content);
      const target = this.targetAfterTransform(inspected.target, planned);
      const absolutePath = await this.absoluteTargetPath(safePath);
      await writeFile(absolutePath, planned.contentAfter, "utf8");
      const after = await stat(absolutePath);
      return { target: { ...target, existsAfter: true, bytesAfter: after.size }, transform: planned };
    });
  }

  private async readExisting(safePath: string): Promise<VaultEditInspection> {
    const normalized = this.normalizePath(safePath);
    const absolutePath = await this.absoluteTargetPath(normalized);
    const exists = await pathExists(absolutePath);
    if (!exists) throw new VaultEditorTargetMissingError();
    await this.assertRealPathContained(absolutePath, "Target note resolves outside the configured vault.");
    const info = await stat(absolutePath);
    if (!info.isFile()) throw new VaultEditorTargetMissingError("Target path is not an existing Markdown note.");
    const content = await readFile(absolutePath, "utf8");
    return { target: { path: normalized, existsBefore: true, existsAfter: true, bytesBefore: info.size }, content };
  }

  private targetAfterTransform(target: EditTargetSummary, transform: EditTransformResult): EditTargetSummary {
    const next: EditTargetSummary = {
      ...target,
      existsAfter: true,
      bytesAfter: Buffer.byteLength(transform.contentAfter, "utf8"),
    };
    if (transform.heading) next.heading = transform.heading;
    if (transform.property) next.property = transform.property;
    return next;
  }

  private async absoluteTargetPath(safePath: string): Promise<string> {
    const root = await this.vaultRootRealpath();
    const absolutePath = path.resolve(root, ...safePath.split("/"));
    assertContained(root, absolutePath, "Target path is outside the configured vault.");
    return absolutePath;
  }

  private async vaultRootRealpath(): Promise<string> {
    this.rootRealpath ??= realpath(this.root).then(async (resolved) => {
      const info = await stat(resolved).catch(() => undefined);
      if (!info?.isDirectory()) throw new VaultEditorSetupError("Configured vault path is not a directory.", "VAULT_NOT_ACCESSIBLE");
      await access(resolved, fsConstants.R_OK | fsConstants.W_OK).catch(() => {
        throw new VaultEditorSetupError("Configured vault path is not readable and writable for obsidian_edit.", "VAULT_NOT_WRITABLE");
      });
      return resolved;
    }).catch((error: unknown) => {
      if (error instanceof VaultEditorSetupError) throw error;
      throw new VaultEditorSetupError("Configured vault path is not accessible.", "VAULT_NOT_ACCESSIBLE");
    });
    return this.rootRealpath;
  }

  private async assertRealPathContained(inputPath: string, message: string): Promise<void> {
    const root = await this.vaultRootRealpath();
    const resolved = await realpath(inputPath).catch(() => undefined);
    if (!resolved) return;
    assertContained(root, resolved, message);
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new VaultEditorSafetyError(message, "UNSAFE_PATH");
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await stat(inputPath);
    return true;
  } catch {
    return false;
  }
}

export function editErrorFromUnknown(error: unknown): { code: string; message: string; category: "safety" | "not_found" | "setup" | "runtime" } {
  if (error instanceof PathSafetyError || error instanceof VaultEditorSafetyError) return { code: "UNSAFE_PATH", message: "The target path is not a safe vault-relative Markdown path.", category: "safety" };
  if (error instanceof VaultEditorTargetMissingError) return { code: error.code, message: error.message, category: "not_found" };
  if (error instanceof VaultEditorSetupError) return { code: error.code, message: error.message, category: "setup" };
  return { code: "EDIT_FAILED", message: "The edit could not be completed safely.", category: "runtime" };
}
