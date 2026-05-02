import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CommitTokenBinding, CommitTokenErrorCode, CommitTokenIssueResult, CommitTokenMetadata, CommitTokenPolicy, CommitTokenService, CommitTokenTool, CommitTokenVerificationResult, TokenRequirementMode } from "./commit-token-types.js";

export const COMMIT_TOKEN_VERSION = "ct1";
export const COMMIT_TOKEN_POLICY_VERSION = "commit-token-v1";
export const COMMIT_TOKEN_MAX_LENGTH = 512;
export const COMMIT_TOKEN_DEFAULT_TTL_SECONDS = 300;
export const COMMIT_TOKEN_MIN_TTL_SECONDS = 30;
export const COMMIT_TOKEN_MAX_TTL_SECONDS = 3600;

const DEFAULT_REQUIRED_OPERATIONS = [
  "obsidian_edit.replace_section",
  "obsidian_edit.replace_exact_text",
  "obsidian_manage.move_note",
  "obsidian_manage.trash_note",
  "obsidian_manage.restore_note",
  "obsidian_manage.copy_note",
] as const;

const STRICT_MUTATION_OPERATIONS = new Set([
  "obsidian_write.create",
  "obsidian_write.append",
  "obsidian_write.create_folder",
  "obsidian_edit.replace_section",
  "obsidian_edit.insert_under_heading",
  "obsidian_edit.update_frontmatter",
  "obsidian_edit.remove_frontmatter",
  "obsidian_edit.replace_exact_text",
  "obsidian_manage.move_note",
  "obsidian_manage.trash_note",
  "obsidian_manage.restore_note",
  "obsidian_manage.copy_note",
]);

export interface CreateCommitTokenPolicyInput {
  tokensRequired?: boolean | undefined;
  strictMode?: boolean | undefined;
  ttlSeconds?: number | undefined;
  policyVersion?: string | undefined;
}

export interface DefaultCommitTokenServiceOptions {
  secret?: Buffer | string | undefined;
  now?: (() => number) | undefined;
  available?: boolean | undefined;
}

interface CommitTokenPayload {
  version: typeof COMMIT_TOKEN_VERSION;
  issuedAt: number;
  expiresAt: number;
  policyVersion: string;
  requirementMode: TokenRequirementMode;
  bindingHash: string;
  nonce: string;
}

export function createCommitTokenPolicy(input: CreateCommitTokenPolicyInput = {}): CommitTokenPolicy {
  const tokensRequired = input.tokensRequired ?? true;
  const strictMode = input.strictMode ?? false;
  const ttlSeconds = clampInteger(input.ttlSeconds, COMMIT_TOKEN_MIN_TTL_SECONDS, COMMIT_TOKEN_MAX_TTL_SECONDS, COMMIT_TOKEN_DEFAULT_TTL_SECONDS);
  const requirementMode: TokenRequirementMode = !tokensRequired ? "disabled" : strictMode ? "strict_all_mutations" : "default_risky";
  return {
    tokensRequired,
    strictMode,
    ttlSeconds,
    policyVersion: input.policyVersion ?? COMMIT_TOKEN_POLICY_VERSION,
    requirementMode,
    defaultRequiredOperations: [...DEFAULT_REQUIRED_OPERATIONS],
  };
}

export const DISABLED_COMMIT_TOKEN_POLICY = createCommitTokenPolicy({ tokensRequired: false });

export function isCommitTokenRequired(policy: CommitTokenPolicy | undefined, tool: CommitTokenTool, operation: string): boolean {
  if (!policy || !policy.tokensRequired || policy.requirementMode === "disabled") return false;
  const key = `${tool}.${operation}`;
  if (policy.requirementMode === "strict_all_mutations") return STRICT_MUTATION_OPERATIONS.has(key);
  return policy.defaultRequiredOperations.includes(key);
}

export function tokenMetadataRequired(policy: CommitTokenPolicy): CommitTokenMetadata {
  return {
    tokenRequired: true,
    tokenTtlSeconds: policy.ttlSeconds,
    tokenPolicy: { mode: policy.requirementMode, version: policy.policyVersion },
  };
}

export function tokenMetadataNotRequired(): CommitTokenMetadata {
  return { tokenRequired: false };
}

export function hashCommitTokenBinding(binding: CommitTokenBinding): string {
  return sha256Hex(canonicalJson(binding));
}

export function hashTokenField(value: unknown): string {
  return sha256Hex(typeof value === "string" ? value : canonicalJson(value));
}

export function tokenFailureMessage(code: CommitTokenErrorCode): string {
  switch (code) {
    case "CONFIRMATION_TOKEN_REQUIRED":
      return "This commit requires a confirmation token from a matching dry-run preview.";
    case "CONFIRMATION_TOKEN_EXPIRED":
      return "The confirmation token has expired. Re-run the dry-run preview and retry with the new token.";
    case "CONFIRMATION_TOKEN_MISMATCH":
      return "The confirmation token does not match this normalized mutation request.";
    case "CONFIRMATION_TOKEN_POLICY_MISMATCH":
      return "The confirmation token was produced for an incompatible token policy or version.";
    case "CONFIRMATION_TOKEN_UNAVAILABLE":
      return "Confirmation token verification is unavailable, so this token-required commit was refused before mutation.";
    case "CONFIRMATION_TOKEN_REVOKED":
      return "The confirmation token is not accepted by the current token policy.";
    case "CONFIRMATION_TOKEN_MALFORMED":
    default:
      return "The confirmation token is malformed or invalid. Re-run the dry-run preview and retry with the returned token.";
  }
}

export class DefaultCommitTokenService implements CommitTokenService {
  private readonly secret: Buffer | undefined;
  private readonly now: () => number;
  private readonly available: boolean;

  constructor(options: DefaultCommitTokenServiceOptions = {}) {
    this.available = options.available ?? true;
    this.secret = this.available ? Buffer.from(options.secret ?? randomBytes(32)) : undefined;
    this.now = options.now ?? (() => Date.now());
  }

  isAvailable(): boolean {
    return this.available && Boolean(this.secret);
  }

  issue(binding: CommitTokenBinding, policy: CommitTokenPolicy): CommitTokenIssueResult {
    if (!this.isAvailable() || !this.secret) return failure("CONFIRMATION_TOKEN_UNAVAILABLE");
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + policy.ttlSeconds;
    const payload: CommitTokenPayload = {
      version: COMMIT_TOKEN_VERSION,
      issuedAt,
      expiresAt,
      policyVersion: policy.policyVersion,
      requirementMode: policy.requirementMode,
      bindingHash: hashCommitTokenBinding(binding),
      nonce: base64url(randomBytes(16)),
    };
    const payloadEncoded = base64url(Buffer.from(canonicalJson(payload), "utf8"));
    const signature = this.sign(payloadEncoded);
    const token = `${COMMIT_TOKEN_VERSION}.${payloadEncoded}.${signature}`;
    if (token.length > COMMIT_TOKEN_MAX_LENGTH) return failure("CONFIRMATION_TOKEN_MALFORMED");
    return {
      ok: true,
      token,
      metadata: {
        tokenRequired: true,
        confirmationToken: token,
        tokenTtlSeconds: policy.ttlSeconds,
        tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
        tokenPolicy: { mode: policy.requirementMode, version: policy.policyVersion },
      },
    };
  }

  verify(token: unknown, binding: CommitTokenBinding, policy: CommitTokenPolicy): CommitTokenVerificationResult {
    if (!this.isAvailable() || !this.secret) return failure("CONFIRMATION_TOKEN_UNAVAILABLE");
    if (token === undefined || token === null || token === "") return failure("CONFIRMATION_TOKEN_REQUIRED");
    if (typeof token !== "string" || token.trim() !== token || token.trim() === "") return failure("CONFIRMATION_TOKEN_MALFORMED");
    if (token.length > COMMIT_TOKEN_MAX_LENGTH) return failure("CONFIRMATION_TOKEN_MALFORMED");
    const parts = token.split(".");
    if (parts.length !== 3) return failure("CONFIRMATION_TOKEN_MALFORMED");
    const [prefix, payloadEncoded, signature] = parts as [string, string, string];
    if (prefix !== COMMIT_TOKEN_VERSION) return failure("CONFIRMATION_TOKEN_POLICY_MISMATCH");
    if (!payloadEncoded || !signature || !safeBase64Url(payloadEncoded) || !safeBase64Url(signature)) return failure("CONFIRMATION_TOKEN_MALFORMED");
    const expectedSignature = this.sign(payloadEncoded);
    if (!safeEqual(signature, expectedSignature)) return failure("CONFIRMATION_TOKEN_MALFORMED");

    let payload: CommitTokenPayload;
    try {
      const parsed = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8")) as unknown;
      if (!isPayload(parsed)) return failure("CONFIRMATION_TOKEN_MALFORMED");
      payload = parsed;
    } catch {
      return failure("CONFIRMATION_TOKEN_MALFORMED");
    }

    if (payload.version !== COMMIT_TOKEN_VERSION) return failure("CONFIRMATION_TOKEN_POLICY_MISMATCH");
    if (payload.policyVersion !== policy.policyVersion || payload.requirementMode !== policy.requirementMode) return failure("CONFIRMATION_TOKEN_POLICY_MISMATCH");
    if (payload.expiresAt < Math.floor(this.now() / 1000)) return failure("CONFIRMATION_TOKEN_EXPIRED");
    if (!safeEqual(payload.bindingHash, hashCommitTokenBinding(binding))) return failure("CONFIRMATION_TOKEN_MISMATCH");
    return { ok: true };
  }

  private sign(payloadEncoded: string): string {
    if (!this.secret) return "";
    return createHmac("sha256", this.secret).update(payloadEncoded).digest("base64url");
  }
}

let defaultService: DefaultCommitTokenService | undefined;

export function defaultCommitTokenService(): DefaultCommitTokenService {
  defaultService ??= new DefaultCommitTokenService();
  return defaultService;
}

function failure(code: CommitTokenErrorCode): CommitTokenVerificationResult & { ok: false } {
  return { ok: false, code, message: tokenFailureMessage(code) };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortCanonical(item)]));
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function safeBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isPayload(value: unknown): value is CommitTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.version === COMMIT_TOKEN_VERSION
    && typeof payload.issuedAt === "number"
    && Number.isInteger(payload.issuedAt)
    && typeof payload.expiresAt === "number"
    && Number.isInteger(payload.expiresAt)
    && payload.expiresAt > payload.issuedAt
    && typeof payload.policyVersion === "string"
    && (payload.requirementMode === "disabled" || payload.requirementMode === "default_risky" || payload.requirementMode === "strict_all_mutations")
    && typeof payload.bindingHash === "string"
    && /^[a-f0-9]{64}$/.test(payload.bindingHash)
    && typeof payload.nonce === "string"
    && payload.nonce.length > 0;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
