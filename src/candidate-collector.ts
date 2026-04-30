import { normalizeVaultFolder, normalizeVaultRelativePath } from "./path-safety.js";
import type { CandidateSeed, ObsidianCliBackend, RetrievalRequest, SearchLine, SeedEvidence } from "./retrieval-types.js";

export async function collectCandidateSeeds(backend: ObsidianCliBackend, request: RetrievalRequest, options: { seedLimit: number }): Promise<CandidateSeed[]> {
  const query = request.query?.trim() ?? "";
  const folder = request.scope?.folder ? normalizeVaultFolder(request.scope.folder) : undefined;
  const seeds = new Map<string, CandidateSeed>();

  const add = (path: string, evidence: SeedEvidence, extra?: { title?: string | undefined; searchLine?: SearchLine | undefined; command?: string | undefined }) => {
    let safePath: string;
    try {
      safePath = normalizeVaultRelativePath(path, { allowEmpty: false, requireMarkdown: true });
    } catch {
      return;
    }
    const existing = seeds.get(safePath) ?? { path: safePath, evidence: [], searchLines: [], sourceCommands: [] };
    if (extra?.title && !existing.title) existing.title = extra.title;
    existing.evidence.push(evidence);
    if (extra?.searchLine) existing.searchLines?.push(extra.searchLine);
    if (extra?.command && !existing.sourceCommands.includes(extra.command)) existing.sourceCommands.push(extra.command);
    seeds.set(safePath, existing);
  };

  const promises: Promise<void>[] = [];
  if (query) {
    for (const searchQuery of focusedQueries(query)) {
      promises.push(backend.search({ query: searchQuery, folder, limit: options.seedLimit }).then((result) => {
        for (const hit of result.hits) add(hit.path, { signal: "content", field: "search", matched: searchQuery, weightHint: hit.scoreHint, command: "search" }, { command: "search" });
      }).catch(() => undefined));
      promises.push(backend.searchContext({ query: searchQuery, folder, limit: options.seedLimit }).then((result) => {
        for (const hit of result.hits) {
          add(hit.path, { signal: "content", field: "search_context", matched: hit.text, line: hit.line, command: "search:context" }, { command: "search:context", searchLine: { path: hit.path, line: hit.line, text: hit.text, query: searchQuery, command: "search:context" } });
        }
      }).catch(() => undefined));
    }
    if (looksLikeMarkdownPath(query)) {
      promises.push(backend.file({ path: query }).then((file) => {
        add(file.path, { signal: "exact_file", field: "path", matched: query, command: "file" }, { title: file.name, command: "file" });
      }).catch(() => undefined));
    } else {
      promises.push(backend.file({ file: query }).then((file) => {
        add(file.path, { signal: "title", field: "file", matched: query, command: "file" }, { title: file.name, command: "file" });
      }).catch(() => undefined));
    }
    promises.push(backend.files({ folder, limit: options.seedLimit }).then((result) => {
      for (const file of result.files) {
        const match = fileNameMatch(file.path, file.name, query);
        if (match) add(file.path, { signal: match.signal, field: match.field, matched: match.term, weightHint: match.weightHint, command: "files" }, { title: file.name, command: "files" });
      }
    }).catch(() => undefined));
  }

  if (folder) {
    promises.push(backend.files({ folder, limit: options.seedLimit }).then((result) => {
      for (const file of result.files) {
        add(file.path, { signal: "project_folder", field: "folder", matched: folder, command: "files" }, { title: file.name, command: "files" });
      }
    }).catch(() => undefined));
  }

  promises.push(backend.aliases({}).then((result) => {
    for (const alias of result.aliases) {
      if (!query || includesFuzzy(alias.alias, query)) {
        for (const path of alias.paths) add(path, { signal: "alias", field: "alias", matched: alias.alias, command: "aliases" }, { command: "aliases" });
      }
    }
  }).catch(() => undefined));

  promises.push(backend.tags({ counts: true }).then((result) => {
    const requestedTags = new Set((request.scope?.tags ?? []).map(normalizeTag));
    for (const tag of result.tags) {
      const normalized = normalizeTag(tag.tag);
      const queryHit = query && (includesFuzzy(normalized, query) || includesFuzzy(query, normalized));
      const scopeHit = requestedTags.size > 0 && requestedTags.has(normalized);
      if (queryHit || scopeHit) {
        for (const path of tag.paths ?? []) add(path, { signal: "tag", field: "tag", matched: tag.tag, command: "tags" }, { command: "tags" });
      }
    }
  }).catch(() => undefined));

  promises.push(backend.properties({ counts: true }).then((result) => {
    const scopeProps = request.scope?.properties ?? {};
    for (const property of result.properties) {
      const valueText = Array.isArray(property.value) ? property.value.join(" ") : property.value === undefined ? "" : String(property.value);
      const searchable = `${property.name} ${valueText}`;
      const queryHit = query && includesFuzzy(searchable, query);
      const scopeHit = Object.entries(scopeProps).some(([name, value]) => property.name === name && valueText.includes(String(value)));
      if (queryHit || scopeHit) {
        for (const path of property.paths ?? []) add(path, { signal: "property", field: property.name, matched: valueText || property.name, command: "properties" }, { command: "properties" });
      }
    }
  }).catch(() => undefined));

  promises.push(backend.recents().then((result) => {
    for (const [index, recent] of result.recents.slice(0, Math.min(10, options.seedLimit)).entries()) {
      if (!query || request.scope?.recent || includesFuzzy(`${recent.title ?? ""} ${recent.path}`, query)) {
        add(recent.path, { signal: "recency", field: "recents", matched: recent.openedAt ?? `recent-${index}`, weightHint: Math.max(1, 10 - index), command: "recents" }, { title: recent.title, command: "recents" });
      }
    }
  }).catch(() => undefined));

  await Promise.all(promises);
  return [...seeds.values()];
}

const STOPWORDS = new Set(["a", "an", "and", "are", "about", "does", "for", "from", "give", "me", "my", "of", "on", "say", "says", "show", "the", "to", "vault", "what", "whats", "with"]);

function focusedQueries(query: string): string[] {
  const terms = significantTerms(query);
  return [...new Set([query, ...terms.slice(0, 4)])];
}

function significantTerms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9#]+/).filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function fileNameMatch(notePath: string, name: string | undefined, query: string): { signal: "title" | "path"; field: string; term: string; weightHint: number } | undefined {
  const title = (name ?? notePath.split("/").pop()?.replace(/\.md$/i, "") ?? notePath).toLowerCase();
  const pathText = notePath.toLowerCase();
  for (const term of significantTerms(query)) {
    if (title.includes(term)) return { signal: "title", field: "file_name", term, weightHint: 80 };
    if (pathText.includes(term)) return { signal: "path", field: "file_path", term, weightHint: 45 };
  }
  return undefined;
}

function looksLikeMarkdownPath(value: string): boolean {
  return value.endsWith(".md") || value.includes("/");
}

function normalizeTag(value: string): string {
  return value.replace(/^#/, "").toLowerCase();
}

function includesFuzzy(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().replace(/^#/, "");
  if (h.includes(n)) return true;
  const terms = n.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every((term) => h.includes(term))) return true;
  return levenshtein(h.replace(/[^a-z0-9]/g, ""), n.replace(/[^a-z0-9]/g, "")) <= Math.max(1, Math.floor(n.length / 4));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let last = i;
    previous[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const old = previous[j + 1] ?? 0;
      const deletion = old + 1;
      const insertion = (previous[j] ?? 0) + 1;
      const substitution = last + (a[i] === b[j] ? 0 : 1);
      previous[j + 1] = Math.min(deletion, insertion, substitution);
      last = old;
    }
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}
