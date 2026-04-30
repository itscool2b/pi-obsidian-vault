export type EvidenceQuality = "strong" | "supporting" | "weak" | "ignored";

export interface QueryProfile {
  original: string;
  normalized: string;
  terms: string[];
  meaningfulTerms: string[];
  stopwords: string[];
  genericTerms: string[];
  phrases: string[];
  quotedPhrases: string[];
  compactVariants: string[];
  hasStrongIdentifier: boolean;
  isLowSignal: boolean;
}

export interface QueryTextMatch {
  quality: EvidenceQuality;
  score: number;
  matchedTerms: string[];
  matchedPhrases: string[];
  matchedGenericTerms: string[];
  matchedStopwords: string[];
  coverage: number;
  exact: boolean;
  fuzzy: boolean;
  isGenericOnly: boolean;
  isStopwordOnly: boolean;
}

export const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "around", "be", "by", "can", "did", "do", "does", "find", "for", "from", "give", "has", "have", "how", "i", "in", "is", "it", "its", "locate", "look", "looking", "me", "most", "my", "of", "on", "or", "per", "please", "say", "says", "show", "that", "the", "this", "to", "was", "what", "whats", "when", "where", "which", "with", "without",
]);

export const GENERIC_TERMS = new Set([
  "note", "notes", "file", "page", "doc", "document", "project", "thing", "stuff", "folder", "vault", "content", "context", "contexts", "information", "details", "main", "general",
  // Common retrieval/task vocabulary that should not identify a note by itself.
  "connection", "connections", "related", "relationship", "relationships", "moc", "overview", "summary", "about", "topic", "item", "items", "best", "relevant", "relevance",
]);

export function createQueryProfile(query: string | undefined): QueryProfile {
  const original = query?.trim() ?? "";
  const normalized = normalizeText(original);
  const terms = unique(tokenize(original));
  const stopwords = terms.filter((term) => isStopword(term));
  const genericTerms = terms.filter((term) => !isStopword(term) && isGenericTerm(term));
  const meaningfulTerms = terms.filter((term) => isMeaningfulTerm(term));
  const quotedPhrases = quotedText(original).map(normalizeText).filter((phrase) => phrase.split(" ").length > 1);
  const naturalPhrases = adjacentPhrases(original);
  const phrases = unique([...quotedPhrases, ...naturalPhrases]).filter((phrase) => phrase.split(" ").length > 1);
  const compactVariants = unique([normalized, ...phrases].map(compact).filter(Boolean));
  const hasPathLike = /[/.\\#]/.test(original) || /\.md$/i.test(original);
  const hasStrongIdentifier = hasPathLike || quotedPhrases.length > 0 || phrases.some((phrase) => phrase.split(" ").some((term) => meaningfulTerms.includes(term))) || meaningfulTerms.length > 0;
  return {
    original,
    normalized,
    terms,
    meaningfulTerms,
    stopwords,
    genericTerms,
    phrases,
    quotedPhrases,
    compactVariants,
    hasStrongIdentifier,
    isLowSignal: meaningfulTerms.length === 0 && quotedPhrases.length === 0 && !hasPathLike,
  };
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9#]+/g, " ").trim().replace(/\s+/g, " ");
}

export function tokenize(value: string): string[] {
  return normalizeText(value).split(" ").map((term) => term.replace(/^#/, "")).filter(Boolean);
}

export function isStopword(term: string): boolean {
  return STOPWORDS.has(term.toLowerCase());
}

export function isGenericTerm(term: string): boolean {
  return GENERIC_TERMS.has(term.toLowerCase());
}

export function isMeaningfulTerm(term: string): boolean {
  const normalized = term.toLowerCase().replace(/^#/, "");
  if (!normalized || isStopword(normalized) || isGenericTerm(normalized)) return false;
  if (/^\d+$/.test(normalized)) return true;
  return normalized.length >= 2;
}

export function significantSearchTerms(profile: QueryProfile, limit = 4): string[] {
  return profile.meaningfulTerms.slice(0, limit);
}

export function focusedQueryTexts(query: string, limit = 4): string[] {
  const profile = createQueryProfile(query);
  return unique([query.trim(), ...profile.phrases.slice(0, 3), ...significantSearchTerms(profile, limit)]).filter(Boolean);
}

export function textMatchProfile(value: string, profile: QueryProfile, options: { structured?: boolean; allowFuzzy?: boolean } = {}): QueryTextMatch {
  const normalizedValue = normalizeText(value);
  const valueTerms = tokenize(value);
  const valueTermSet = new Set(valueTerms);
  const directMatchedPhrases = profile.phrases.filter((phrase) => normalizedValue.includes(phrase));
  const acronymMatchedPhrases = options.structured ? acronymPhraseMatches(profile.phrases, valueTermSet) : [];
  const matchedPhrases = unique([...directMatchedPhrases, ...acronymMatchedPhrases]);
  const acronymTerms = new Set(acronymMatchedPhrases.flatMap((phrase) => tokenize(phrase)).filter((term) => profile.meaningfulTerms.includes(term)));
  const matchedTerms = profile.meaningfulTerms.filter((term) => acronymTerms.has(term) || termMatchesValue(term, normalizedValue, valueTermSet));
  const matchedGenericTerms = profile.genericTerms.filter((term) => termMatchesValue(term, normalizedValue, valueTermSet));
  const matchedStopwords = profile.stopwords.filter((term) => termMatchesValue(term, normalizedValue, valueTermSet));
  const exact = Boolean(profile.normalized && normalizedValue === profile.normalized);
  const compactMatch = profile.compactVariants.some((variant) => variant.length > 2 && compact(normalizedValue).includes(variant));
  const fuzzy = Boolean(options.allowFuzzy && !exact && matchedPhrases.length === 0 && fuzzyTermMatch(valueTerms, profile.meaningfulTerms));
  const meaningfulTotal = Math.max(1, profile.meaningfulTerms.length);
  const coverage = profile.meaningfulTerms.length === 0 ? 0 : matchedTerms.length / meaningfulTotal;
  const isStopwordOnly = matchedTerms.length === 0 && matchedGenericTerms.length === 0 && matchedStopwords.length > 0;
  const isGenericOnly = matchedTerms.length === 0 && matchedGenericTerms.length > 0;

  let quality: EvidenceQuality = "ignored";
  let score = 0;
  if (!profile.normalized || !normalizedValue) {
    quality = "ignored";
  } else if ((exact || compactMatch) && profile.meaningfulTerms.length === 0 && matchedGenericTerms.length > 0) {
    quality = options.structured ? "strong" : "weak";
    score = options.structured ? 0.78 : 0.12;
  } else if (exact || matchedPhrases.length > 0 || compactMatch) {
    quality = "strong";
    score = exact ? 1 : matchedPhrases.length > 0 ? 0.95 : 0.88;
  } else if (matchedTerms.length > 0) {
    const requiredCoverage = profile.meaningfulTerms.length <= 2 ? 1 : 0.66;
    if (coverage >= requiredCoverage) {
      quality = options.structured ? "strong" : "supporting";
      score = options.structured ? 0.82 + Math.min(0.12, coverage * 0.12) : 0.62 + Math.min(0.2, coverage * 0.2);
    } else {
      quality = "weak";
      score = options.structured ? 0.18 + coverage * 0.22 : 0.12 + coverage * 0.2;
    }
  } else if (fuzzy) {
    quality = options.structured ? "supporting" : "weak";
    score = options.structured ? 0.55 : 0.25;
  } else if (isGenericOnly) {
    quality = options.structured ? "supporting" : "weak";
    score = options.structured ? 0.28 : 0.08;
  } else if (isStopwordOnly) {
    quality = "ignored";
    score = 0;
  }

  return {
    quality,
    score: Number(score.toFixed(3)),
    matchedTerms,
    matchedPhrases,
    matchedGenericTerms,
    matchedStopwords,
    coverage: Number(coverage.toFixed(3)),
    exact,
    fuzzy,
    isGenericOnly,
    isStopwordOnly,
  };
}

export function strongestQuality(...qualities: Array<EvidenceQuality | undefined>): EvidenceQuality {
  const order: Record<EvidenceQuality, number> = { ignored: 0, weak: 1, supporting: 2, strong: 3 };
  return qualities.filter(Boolean).sort((a, b) => order[b as EvidenceQuality] - order[a as EvidenceQuality])[0] ?? "ignored";
}

export function qualityRank(quality: EvidenceQuality | undefined): number {
  switch (quality) {
    case "strong": return 3;
    case "supporting": return 2;
    case "weak": return 1;
    default: return 0;
  }
}

export function compact(value: string): string {
  return value.replace(/[^a-z0-9#]/g, "");
}

function termMatchesValue(term: string, normalizedValue: string, valueTermSet: Set<string>): boolean {
  return termVariants(term).some((variant) => valueTermSet.has(variant) || (variant.length >= 3 && normalizedValue.includes(variant)));
}

function termVariants(term: string): string[] {
  const variants = new Set([term]);
  if (term.endsWith("s") && term.length > 3) variants.add(term.slice(0, -1));
  if (term.endsWith("ed") && term.length > 5) {
    const base = term.slice(0, -2);
    variants.add(base);
    if (base.endsWith("ss")) variants.add(base);
  }
  if (term.endsWith("ing") && term.length > 6) variants.add(term.slice(0, -3));
  return [...variants].filter(Boolean);
}

function acronymPhraseMatches(phrases: string[], valueTermSet: Set<string>): string[] {
  const matches: string[] = [];
  for (const phrase of phrases) {
    const phraseTerms = tokenize(phrase).filter(isMeaningfulTerm);
    if (phraseTerms.length < 2) continue;
    const acronym = phraseTerms.map((term) => term.slice(0, 1)).join("");
    if (acronym.length < 2 || isStopword(acronym) || isGenericTerm(acronym)) continue;
    if (valueTermSet.has(acronym)) matches.push(phrase);
  }
  return unique(matches);
}

function quotedText(value: string): string[] {
  const matches = [...value.matchAll(/["“”']([^"“”']+)["“”']/g)];
  return matches.map((match) => match[1] ?? "");
}

function adjacentPhrases(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const chunks = normalized.split(/\b(?:a|an|and|are|as|at|around|by|did|do|does|for|from|how|in|is|it|of|on|or|the|this|to|was|what|when|where|which|with)\b/g)
    .map((chunk) => chunk.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const phrases: string[] = [];
  for (const chunk of chunks) {
    const chunkTerms = chunk.split(" ").filter((term) => !isStopword(term));
    if (chunkTerms.length >= 2 && chunkTerms.some((term) => isMeaningfulTerm(term))) phrases.push(chunkTerms.join(" "));
    for (let size = Math.min(4, chunkTerms.length); size >= 2; size -= 1) {
      for (let index = 0; index <= chunkTerms.length - size; index += 1) {
        const phraseTerms = chunkTerms.slice(index, index + size);
        if (phraseTerms.some((term) => isMeaningfulTerm(term))) phrases.push(phraseTerms.join(" "));
      }
    }
  }
  return unique(phrases);
}

function fuzzyTermMatch(valueTerms: string[], queryTerms: string[]): boolean {
  if (queryTerms.length !== 1) return false;
  const query = queryTerms[0] ?? "";
  if (query.length < 5) return false;
  return valueTerms.some((word) => {
    const distance = levenshtein(word, query);
    return distance <= Math.max(1, Math.floor(query.length * 0.3));
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const costs = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let previous = i;
    costs[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const current = costs[j + 1] ?? 0;
      costs[j + 1] = Math.min(current + 1, (costs[j] ?? 0) + 1, previous + (a[i] === b[j] ? 0 : 1));
      previous = current;
    }
  }
  return costs[b.length] ?? Math.max(a.length, b.length);
}
