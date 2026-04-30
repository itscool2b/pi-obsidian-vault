import type { EnrichedCandidateSeed } from "./metadata-enricher.js";

export function buildPreview(candidate: EnrichedCandidateSeed, query: string | undefined, maxChars: number): string {
  const lines = candidate.searchLines?.map((line) => line.text.trim()).filter(Boolean) ?? [];
  const headingHit = candidate.metadata.headings?.find((heading) => query && containsTerms(heading.text, query))?.text;
  const evidence = candidate.evidence.map((item) => item.matched).filter(Boolean);
  const fallback = candidate.metadata.headings?.map((heading) => heading.text) ?? [];
  const combined = [...lines, ...(headingHit ? [`# ${headingHit}`] : []), ...evidence, ...fallback]
    .map(normalizeWhitespace)
    .filter(Boolean);
  const unique = [...new Set(combined)];
  const preview = unique.join(" • ") || candidate.title;
  return clip(preview, maxChars);
}

export function clip(value: string, maxChars: number): string {
  const clean = normalizeWhitespace(value);
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 1) return clean.slice(0, Math.max(0, maxChars));
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsTerms(value: string, query: string): boolean {
  const lower = value.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).some((term) => lower.includes(term));
}
