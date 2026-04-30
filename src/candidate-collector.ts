import { normalizeVaultFolder, normalizeVaultRelativePath } from "./path-safety.js";
import { createQueryProfile, focusedQueryTexts, textMatchProfile } from "./query-profile.js";
import type { CandidateSeed, DegradedSignal, ObsidianCliBackend, RetrievalRequest, SearchLine, SeedEvidence } from "./retrieval-types.js";

export async function collectCandidateSeeds(backend: ObsidianCliBackend, request: RetrievalRequest, options: { seedLimit: number; degradedSignals?: Set<DegradedSignal> | undefined }): Promise<CandidateSeed[]> {
  const query = request.query?.trim() ?? "";
  const profile = createQueryProfile(query);
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
    for (const searchQuery of focusedQueryTexts(query)) {
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
      if (!query || valueMatchesQuery(alias.alias, profile, true)) {
        for (const path of alias.paths) add(path, { signal: "alias", field: "alias", matched: alias.alias, command: "aliases" }, { command: "aliases" });
      }
    }
  }).catch(() => { options.degradedSignals?.add("metadata"); }));

  promises.push(backend.tags({ counts: true }).then((result) => {
    const requestedTags = new Set((request.scope?.tags ?? []).map(normalizeTag));
    for (const tag of result.tags) {
      const normalized = normalizeTag(tag.tag);
      const queryHit = query && (valueMatchesQuery(normalized, profile, true) || valueMatchesQuery(query, createQueryProfile(normalized), true));
      const scopeHit = requestedTags.size > 0 && requestedTags.has(normalized);
      if (queryHit || scopeHit) {
        for (const path of tag.paths ?? []) add(path, { signal: "tag", field: "tag", matched: tag.tag, command: "tags" }, { command: "tags" });
      }
    }
  }).catch(() => { options.degradedSignals?.add("metadata"); }));

  promises.push(backend.properties({ counts: true }).then((result) => {
    const scopeProps = request.scope?.properties ?? {};
    for (const property of result.properties) {
      const valueText = Array.isArray(property.value) ? property.value.join(" ") : property.value === undefined ? "" : String(property.value);
      const searchable = `${property.name} ${valueText}`;
      const queryHit = query && valueMatchesQuery(searchable, profile, true);
      const scopeHit = Object.entries(scopeProps).some(([name, value]) => property.name === name && valueText.includes(String(value)));
      if (queryHit || scopeHit) {
        for (const path of property.paths ?? []) add(path, { signal: "property", field: property.name, matched: valueText || property.name, command: "properties" }, { command: "properties" });
      }
    }
  }).catch(() => { options.degradedSignals?.add("properties"); }));

  promises.push(backend.recents().then((result) => {
    for (const [index, recent] of result.recents.slice(0, Math.min(10, options.seedLimit)).entries()) {
      if (!query || request.scope?.recent || valueMatchesQuery(`${recent.title ?? ""} ${recent.path}`, profile, true)) {
        add(recent.path, { signal: "recency", field: "recents", matched: recent.openedAt ?? `recent-${index}`, weightHint: Math.max(1, 10 - index), command: "recents" }, { title: recent.title, command: "recents" });
      }
    }
  }).catch(() => { options.degradedSignals?.add("recents"); }));

  await Promise.all(promises);
  return [...seeds.values()];
}

function fileNameMatch(notePath: string, name: string | undefined, query: string): { signal: "title" | "path"; field: string; term: string; weightHint: number } | undefined {
  const profile = createQueryProfile(query);
  const title = name ?? notePath.split("/").pop()?.replace(/\.md$/i, "") ?? notePath;
  const titleMatch = textMatchProfile(title, profile, { structured: true, allowFuzzy: true });
  if (titleMatch.quality === "strong" || titleMatch.quality === "supporting") {
    const term = titleMatch.matchedPhrases[0] ?? titleMatch.matchedTerms[0] ?? titleMatch.matchedGenericTerms[0] ?? query;
    return { signal: "title", field: "file_name", term, weightHint: titleMatch.exact ? 90 : titleMatch.matchedPhrases.length > 0 ? 45 : 20 };
  }
  if (profile.normalized.length < 3) return undefined;
  const pathMatch = textMatchProfile(notePath, profile, { structured: true, allowFuzzy: false });
  if (pathMatch.quality === "strong" || pathMatch.quality === "supporting") {
    const term = pathMatch.matchedPhrases[0] ?? pathMatch.matchedTerms[0] ?? pathMatch.matchedGenericTerms[0] ?? query;
    return { signal: "path", field: "file_path", term, weightHint: pathMatch.quality === "strong" ? 60 : 20 };
  }
  return undefined;
}

function looksLikeMarkdownPath(value: string): boolean {
  return value.endsWith(".md") || value.includes("/");
}

function normalizeTag(value: string): string {
  return value.replace(/^#/, "").toLowerCase();
}

function valueMatchesQuery(value: string, profile: ReturnType<typeof createQueryProfile>, structured: boolean): boolean {
  const match = textMatchProfile(value, profile, { structured, allowFuzzy: structured });
  return match.quality === "strong" || match.quality === "supporting";
}
