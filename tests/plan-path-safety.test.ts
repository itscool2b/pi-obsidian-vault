import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
import { UNSAFE_NOTE_PATHS } from "./release-hardening-fixtures.js";
import { withTempVault } from "./write-test-utils.js";

describe("obsidian_plan path safety", () => {
  it("reports unsafe planned paths as error issues without echoing unsafe raw input", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const unsafe of UNSAFE_NOTE_PATHS) {
        const result = await obsidianPlan({ operations: [{ id: "unsafe", tool: "obsidian_write", operation: "create", path: unsafe, content: "# Unsafe" }] }, { vaultRoot });
        expect(result.valid).toBe(false);
        expect(result.issues.some((issue) => issue.severity === "error" && ["UNSAFE_PATH", "TARGET_NOT_MARKDOWN", "MISSING_PATH"].includes(issue.code))).toBe(true);
        if (unsafe.startsWith("/") || unsafe.includes("Users")) expect(JSON.stringify(result)).not.toContain(unsafe);
      }
    });
  });

  it("validates retrieve.relationships planned paths with the same explicit-note safety boundary", async () => {
    const result = await obsidianPlan({ operations: [{ id: "rel", tool: "obsidian_retrieve", operation: "relationships", path: "../outside.md" }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNSAFE_PATH", operationId: "rel" }));
    expect(JSON.stringify(result)).not.toContain("../outside.md");
  });
});
