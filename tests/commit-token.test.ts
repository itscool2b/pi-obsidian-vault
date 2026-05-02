import { describe, expect, it } from "vitest";
import { createCommitTokenPolicy, DefaultCommitTokenService, hashCommitTokenBinding, isCommitTokenRequired } from "../src/commit-token.js";
import type { CommitTokenBinding } from "../src/commit-token-types.js";

function binding(overrides: Partial<CommitTokenBinding> = {}): CommitTokenBinding {
  const policy = createCommitTokenPolicy();
  return {
    tool: "obsidian_edit",
    operation: "replace_section",
    policyVersion: policy.policyVersion,
    requirementMode: policy.requirementMode,
    path: "Notes/Plan.md",
    heading: "## Plan",
    contentHash: "abc",
    contentLength: 3,
    ...overrides,
  };
}

describe("commit token service", () => {
  it("issues bounded HMAC tokens and verifies the exact binding", () => {
    const policy = createCommitTokenPolicy({ ttlSeconds: 60 });
    const service = new DefaultCommitTokenService({ secret: "test-secret", now: () => 1_000_000 });
    const issued = service.issue(binding(), policy);

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.token).toMatch(/^ct1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(issued.token.length).toBeLessThanOrEqual(512);
    expect(issued.metadata.tokenExpiresAt).toBe("1970-01-01T00:17:40.000Z");
    expect(service.verify(issued.token, binding(), policy)).toEqual({ ok: true });
    expect(service.verify(issued.token, binding(), policy)).toEqual({ ok: true });
  });

  it("refuses missing, malformed, overlong, unsupported-version, expired, policy-mismatched, and binding-mismatched tokens", () => {
    let now = 1_000_000;
    const policy = createCommitTokenPolicy({ ttlSeconds: 30 });
    const service = new DefaultCommitTokenService({ secret: "test-secret", now: () => now });
    const issued = service.issue(binding(), policy);
    if (!issued.ok) throw new Error("expected token");

    expect(service.verify(undefined, binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_REQUIRED" });
    expect(service.verify("ct1.not.token", binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_MALFORMED" });
    expect(service.verify(`ct1.${"a".repeat(600)}.sig`, binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_MALFORMED" });
    expect(service.verify(issued.token.replace(/^ct1\./, "ct9."), binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_POLICY_MISMATCH" });
    expect(service.verify(issued.token, binding({ path: "Notes/Other.md" }), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_MISMATCH" });
    expect(service.verify(issued.token, binding(), createCommitTokenPolicy({ strictMode: true }))).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_POLICY_MISMATCH" });
    now = 1_031_000;
    expect(service.verify(issued.token, binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_EXPIRED" });
  });

  it("fails closed when token service state is unavailable", () => {
    const policy = createCommitTokenPolicy();
    const service = new DefaultCommitTokenService({ available: false });
    expect(service.isAvailable()).toBe(false);
    expect(service.issue(binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_UNAVAILABLE" });
    expect(service.verify("ct1.payload.signature", binding(), policy)).toMatchObject({ ok: false, code: "CONFIRMATION_TOKEN_UNAVAILABLE" });
  });

  it("classifies default, strict, and disabled token policy requirements", () => {
    const defaultPolicy = createCommitTokenPolicy();
    const strictPolicy = createCommitTokenPolicy({ strictMode: true });
    const disabledPolicy = createCommitTokenPolicy({ tokensRequired: false });

    expect(isCommitTokenRequired(defaultPolicy, "obsidian_edit", "replace_section")).toBe(true);
    expect(isCommitTokenRequired(defaultPolicy, "obsidian_edit", "update_frontmatter")).toBe(false);
    expect(isCommitTokenRequired(defaultPolicy, "obsidian_write", "append")).toBe(false);
    expect(isCommitTokenRequired(defaultPolicy, "obsidian_manage", "copy_note")).toBe(true);
    expect(isCommitTokenRequired(strictPolicy, "obsidian_write", "append")).toBe(true);
    expect(isCommitTokenRequired(disabledPolicy, "obsidian_manage", "move_note")).toBe(false);
  });

  it("hashes bindings deterministically without exposing raw token payloads", () => {
    expect(hashCommitTokenBinding(binding({ contentHash: "abc" }))).toBe(hashCommitTokenBinding(binding({ contentHash: "abc" })));
    expect(hashCommitTokenBinding(binding({ contentHash: "abc" }))).not.toBe(hashCommitTokenBinding(binding({ contentHash: "def" })));
  });
});
