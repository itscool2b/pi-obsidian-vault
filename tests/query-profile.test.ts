import { describe, expect, it } from "vitest";
import { createQueryProfile, GENERIC_TERMS, textMatchProfile } from "../src/query-profile.js";

describe("query profile", () => {
  it("separates stopwords, initial generic terms, meaningful terms, and phrases", () => {
    const profile = createQueryProfile("what is this project and how did it progress?");

    expect(profile.stopwords).toEqual(expect.arrayContaining(["what", "is", "this", "how", "did", "it"]));
    expect(profile.genericTerms).toContain("project");
    expect(profile.meaningfulTerms).toContain("progress");
    expect(profile.meaningfulTerms).not.toContain("project");
    for (const term of ["note", "notes", "file", "page", "doc", "document", "project", "thing", "stuff", "folder", "vault", "content", "information", "details", "main", "general"]) {
      expect(GENERIC_TERMS.has(term)).toBe(true);
    }
  });

  it("extracts phrase and path/title-friendly variants while keeping short aliases meaningful", () => {
    const phraseProfile = createQueryProfile("per-step integrated gradients");
    expect(phraseProfile.meaningfulTerms).toEqual(expect.arrayContaining(["step", "integrated", "gradients"]));
    expect(phraseProfile.meaningfulTerms).not.toContain("per");
    expect(phraseProfile.phrases).toContain("step integrated gradients");
    expect(phraseProfile.compactVariants).toContain("perstepintegratedgradients");

    const aliasProfile = createQueryProfile("IG");
    expect(aliasProfile.meaningfulTerms).toEqual(["ig"]);
    expect(aliasProfile.isLowSignal).toBe(false);
  });

  it("keeps generic terms weak unless backed by structured evidence", () => {
    const profile = createQueryProfile("general project details");
    const bodyMatch = textMatchProfile("general project details", profile, { structured: false });
    const titleMatch = textMatchProfile("General Project Details", profile, { structured: true });

    expect(bodyMatch.quality).toBe("weak");
    expect(bodyMatch.isGenericOnly).toBe(true);
    expect(titleMatch.quality).toMatch(/^(strong|supporting)$/);
  });
});
