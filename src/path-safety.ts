import path from "node:path";
import { PathSafetyError } from "./errors.js";

export function normalizeVaultRelativePath(input: string, options: { allowEmpty: boolean; requireMarkdown: boolean }): string {
  const withoutAt = input.startsWith("@") ? input.slice(1) : input;
  if (withoutAt.trim() === "") {
    if (options.allowEmpty) return "";
    throw new PathSafetyError("Path must not be empty", "EMPTY_PATH");
  }

  if (path.isAbsolute(withoutAt) || path.win32.isAbsolute(withoutAt)) {
    throw new PathSafetyError("Path must be vault-relative", "ABSOLUTE_PATH");
  }

  const decoded = decodePath(withoutAt);
  const slashPath = decoded.replace(/\\+/g, "/");
  const rawSegments = slashPath.split("/").filter(Boolean);
  if (rawSegments.some((segment) => segment === ".." || segment === ".")) {
    throw new PathSafetyError("Path traversal is not allowed", "TRAVERSAL");
  }
  if (rawSegments.some((segment) => segment.toLowerCase() === ".obsidian")) {
    throw new PathSafetyError(".obsidian paths are blocked", "OBSIDIAN_BLOCKED");
  }
  if (rawSegments.some((segment) => segment.startsWith("."))) {
    throw new PathSafetyError("Hidden paths are blocked", "HIDDEN_PATH");
  }

  const normalized = path.posix.normalize(slashPath);
  if (normalized === "." || normalized === "") {
    if (options.allowEmpty) return "";
    throw new PathSafetyError("Path must not be empty", "EMPTY_PATH");
  }
  if (normalized.startsWith("../") || normalized === "..") {
    throw new PathSafetyError("Path traversal is not allowed", "TRAVERSAL");
  }
  if (options.requireMarkdown && path.posix.extname(normalized).toLowerCase() !== ".md") {
    throw new PathSafetyError("Only Markdown (.md) files are supported", "NON_MARKDOWN");
  }
  return normalized;
}

export function normalizeVaultFolder(input = ""): string {
  return normalizeVaultRelativePath(input, { allowEmpty: true, requireMarkdown: false });
}

export function isSafeMarkdownPath(input: string): boolean {
  try {
    normalizeVaultRelativePath(input, { allowEmpty: false, requireMarkdown: true });
    return true;
  } catch {
    return false;
  }
}

export function isSafeFolderPath(input: string): boolean {
  try {
    normalizeVaultFolder(input);
    return true;
  } catch {
    return false;
  }
}

function decodePath(input: string): string {
  let current = input;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return decoded;
      current = decoded;
    } catch {
      throw new PathSafetyError("Path traversal is not allowed", "INVALID_ENCODING");
    }
  }
  return current;
}
