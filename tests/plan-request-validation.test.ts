import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";

describe("obsidian_plan request validation", () => {
  it("returns validation_error for missing, non-array, empty, and too-large operations", async () => {
    const missing = await obsidianPlan({});
    const nonArray = await obsidianPlan({ operations: "nope" as any });
    const empty = await obsidianPlan({ operations: [] });
    const tooMany = await obsidianPlan({ operations: Array.from({ length: 26 }, () => ({ tool: "write", operation: "create", path: "A.md", content: "# A" })) });

    expect(missing).toMatchObject({ status: "validation_error", valid: false, issues: [expect.objectContaining({ code: "MISSING_OPERATIONS" })] });
    expect(nonArray.issues[0]?.code).toBe("OPERATIONS_NOT_ARRAY");
    expect(empty.issues[0]?.code).toBe("EMPTY_OPERATIONS");
    expect(tooMany.issues[0]?.code).toBe("TOO_MANY_OPERATIONS");
  });

  it("reports unsupported operation and missing required fields as error issues", async () => {
    const result = await obsidianPlan({ operations: [
      { id: "bad", tool: "obsidian_write", operation: "overwrite", path: "Notes/A.md", content: "x" },
      { id: "missing", tool: "obsidian_edit", operation: "replace_section", path: "Notes/A.md" },
    ] });
    expect(result.status).toBe("success");
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FORBIDDEN_OPERATION", operationId: "bad" }),
      expect.objectContaining({ code: "MISSING_HEADING", operationId: "missing" }),
      expect.objectContaining({ code: "MISSING_CONTENT", operationId: "missing" }),
    ]));
  });
});
