export type CommitTokenTool = "obsidian_write" | "obsidian_edit" | "obsidian_manage";
export type TokenRequirementMode = "disabled" | "default_risky" | "strict_all_mutations";

export interface CommitTokenPolicy {
  tokensRequired: boolean;
  strictMode: boolean;
  ttlSeconds: number;
  policyVersion: string;
  requirementMode: TokenRequirementMode;
  defaultRequiredOperations: string[];
}

export interface CommitTokenBinding {
  tool: CommitTokenTool;
  operation: string;
  policyVersion: string;
  requirementMode: TokenRequirementMode;
  path?: string | undefined;
  fromPath?: string | undefined;
  toPath?: string | undefined;
  trashPath?: string | undefined;
  trashFolder?: string | undefined;
  heading?: string | undefined;
  property?: string | undefined;
  valueHash?: string | undefined;
  contentHash?: string | undefined;
  contentLength?: number | undefined;
  oldTextHash?: string | undefined;
  oldTextLength?: number | undefined;
  newTextHash?: string | undefined;
  newTextLength?: number | undefined;
}

export interface CommitTokenMetadata {
  tokenRequired?: boolean | undefined;
  confirmationToken?: string | undefined;
  tokenTtlSeconds?: number | undefined;
  tokenExpiresAt?: string | undefined;
  tokenPolicy?: {
    mode: TokenRequirementMode;
    version: string;
  } | undefined;
}

export type CommitTokenErrorCode =
  | "CONFIRMATION_TOKEN_REQUIRED"
  | "CONFIRMATION_TOKEN_MALFORMED"
  | "CONFIRMATION_TOKEN_EXPIRED"
  | "CONFIRMATION_TOKEN_MISMATCH"
  | "CONFIRMATION_TOKEN_POLICY_MISMATCH"
  | "CONFIRMATION_TOKEN_UNAVAILABLE"
  | "CONFIRMATION_TOKEN_REVOKED";

export type CommitTokenVerificationResult =
  | { ok: true }
  | { ok: false; code: CommitTokenErrorCode; message: string };

export type CommitTokenIssueResult =
  | { ok: true; token: string; metadata: Required<Pick<CommitTokenMetadata, "tokenRequired" | "confirmationToken" | "tokenTtlSeconds" | "tokenExpiresAt" | "tokenPolicy">> }
  | { ok: false; code: CommitTokenErrorCode; message: string };

export interface CommitTokenService {
  issue(binding: CommitTokenBinding, policy: CommitTokenPolicy): CommitTokenIssueResult;
  verify(token: unknown, binding: CommitTokenBinding, policy: CommitTokenPolicy): CommitTokenVerificationResult;
  isAvailable(): boolean;
}
