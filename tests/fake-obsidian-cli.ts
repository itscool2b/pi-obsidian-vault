import path from "node:path";
import type {
  AliasesCommandResult,
  BacklinksCommandResult,
  FileInfoCommandResult,
  FileListCommandResult,
  FilesCommandInput,
  FolderListCommandResult,
  FoldersCommandInput,
  LinksCommandResult,
  ObsidianCliBackend,
  ObsidianCliHealth,
  OptionalPathCommandInput,
  OutlineCommandResult,
  PathCommandInput,
  PropertiesCommandResult,
  ReadCommandResult,
  RecentsCommandResult,
  SearchCommandInput,
  SearchCommandResult,
  SearchContextCommandResult,
  TagsCommandResult,
  FileCommandInput,
} from "../src/retrieval-types.js";

export interface FakeNote {
  path: string;
  title: string;
  content: string;
  aliases?: string[];
  tags?: string[];
  properties?: Record<string, string | number | boolean | string[]>;
  links?: string[];
  modified?: string;
  openedAt?: string;
}

export class FakeObsidianCliBackend implements ObsidianCliBackend {
  readonly notes = new Map<string, FakeNote>();
  readonly calls: Array<{ method: string; input?: unknown }> = [];
  available = true;

  addNote(note: FakeNote): this {
    this.notes.set(note.path, note);
    return this;
  }

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  readPaths(): string[] {
    return this.calls.filter((call) => call.method === "read").map((call) => (call.input as PathCommandInput).path);
  }

  async checkHealth(): Promise<ObsidianCliHealth> {
    this.calls.push({ method: "checkHealth" });
    return { available: this.available, version: "fake-1.0.0", cliPath: "fake-obsidian", errors: [], warnings: [] };
  }

  async search(input: SearchCommandInput): Promise<SearchCommandResult> {
    this.calls.push({ method: "search", input });
    const hits = this.matchingNotes(input.query, input.folder).map((note) => ({ path: note.path, scoreHint: scoreText(note, input.query) }));
    return { hits: hits.slice(0, input.limit), total: hits.length, limited: hits.length > input.limit };
  }

  async searchContext(input: SearchCommandInput): Promise<SearchContextCommandResult> {
    this.calls.push({ method: "searchContext", input });
    const hits = [] as Array<{ path: string; line: number; text: string }>;
    for (const note of this.matchingNotes(input.query, input.folder)) {
      const lines = note.content.split(/\r?\n/);
      const lineIndex = lines.findIndex((line) => fuzzyIncludes(line, input.query));
      hits.push({ path: note.path, line: lineIndex >= 0 ? lineIndex + 1 : 1, text: lines[lineIndex >= 0 ? lineIndex : 0] ?? note.title });
    }
    return { hits: hits.slice(0, input.limit), total: hits.length, limited: hits.length > input.limit };
  }

  async files(input: FilesCommandInput): Promise<FileListCommandResult> {
    this.calls.push({ method: "files", input });
    const files = [...this.notes.values()]
      .filter((note) => !input.folder || note.path.startsWith(`${input.folder.replace(/\/$/, "")}/`))
      .map((note) => fileItem(note));
    const limit = input.limit ?? files.length;
    return { files: files.slice(0, limit), total: files.length, limited: files.length > limit };
  }

  async folders(input: FoldersCommandInput): Promise<FolderListCommandResult> {
    this.calls.push({ method: "folders", input });
    const counts = new Map<string, number>();
    for (const note of this.notes.values()) {
      const folder = path.posix.dirname(note.path) === "." ? "" : path.posix.dirname(note.path);
      if (input.folder && !folder.startsWith(input.folder)) continue;
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const folders = [...counts.entries()].map(([folderPath, noteCount]) => ({ path: folderPath, name: path.posix.basename(folderPath), noteCount }));
    const limit = input.limit ?? folders.length;
    return { folders: folders.slice(0, limit), total: folders.length, limited: folders.length > limit };
  }

  async file(input: FileCommandInput): Promise<FileInfoCommandResult> {
    this.calls.push({ method: "file", input });
    const note = input.path ? this.notes.get(input.path) : [...this.notes.values()].find((candidate) => sameTitle(candidate.title, input.file ?? "") || candidate.aliases?.some((alias) => sameTitle(alias, input.file ?? "")) || path.posix.basename(candidate.path, ".md").toLowerCase() === (input.file ?? "").toLowerCase());
    if (!note) throw new Error("not found");
    const info: FileInfoCommandResult = { path: note.path, name: note.title, extension: ".md", size: note.content.length };
    if (note.modified) info.modified = note.modified;
    return info;
  }

  async read(input: PathCommandInput): Promise<ReadCommandResult> {
    this.calls.push({ method: "read", input });
    const note = this.notes.get(input.path);
    if (!note) throw new Error("not found");
    return { path: note.path, content: note.content };
  }

  async outline(input: PathCommandInput): Promise<OutlineCommandResult> {
    this.calls.push({ method: "outline", input });
    const note = this.notes.get(input.path);
    if (!note) throw new Error("not found");
    const headings = note.content.split(/\r?\n/).map((line, index) => ({ line, index })).flatMap(({ line, index }) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      return match ? [{ text: match[2] ?? "", level: match[1]?.length ?? 1, line: index + 1 }] : [];
    });
    return { path: input.path, headings, limited: false };
  }

  async aliases(input: OptionalPathCommandInput): Promise<AliasesCommandResult> {
    this.calls.push({ method: "aliases", input });
    const aliases = [] as Array<{ alias: string; paths: string[] }>;
    for (const note of this.notes.values()) {
      if (input.path && input.path !== note.path) continue;
      for (const alias of note.aliases ?? []) aliases.push({ alias, paths: [note.path] });
    }
    return { aliases, limited: false };
  }

  async tags(input: OptionalPathCommandInput & { counts?: boolean; tag?: string }): Promise<TagsCommandResult> {
    this.calls.push({ method: "tags", input });
    const map = new Map<string, string[]>();
    for (const note of this.notes.values()) {
      if (input.path && input.path !== note.path) continue;
      for (const tag of note.tags ?? []) {
        if (input.tag && normalizeTag(input.tag) !== normalizeTag(tag)) continue;
        const paths = map.get(tag) ?? [];
        paths.push(note.path);
        map.set(tag, paths);
      }
    }
    const tags = [...map.entries()].map(([tag, paths]) => ({ tag, count: paths.length, paths }));
    return { tags, total: tags.length, limited: false };
  }

  async properties(input: OptionalPathCommandInput & { name?: string; counts?: boolean }): Promise<PropertiesCommandResult> {
    this.calls.push({ method: "properties", input });
    const rows = [] as Array<{ name: string; value: string | number | boolean | string[]; paths: string[]; count: number }>;
    const byKey = new Map<string, { name: string; value: string | number | boolean | string[]; paths: string[] }>();
    for (const note of this.notes.values()) {
      if (input.path && input.path !== note.path) continue;
      for (const [name, value] of Object.entries(note.properties ?? {})) {
        if (input.name && input.name !== name) continue;
        const key = `${name}:${String(value)}`;
        const existing = byKey.get(key) ?? { name, value, paths: [] };
        existing.paths.push(note.path);
        byKey.set(key, existing);
      }
    }
    for (const item of byKey.values()) rows.push({ ...item, count: item.paths.length });
    return { properties: rows, total: rows.length, limited: false };
  }

  async links(input: PathCommandInput): Promise<LinksCommandResult> {
    this.calls.push({ method: "links", input });
    const note = this.notes.get(input.path);
    if (!note) throw new Error("not found");
    const links = (note.links ?? []).map((target, index) => ({ path: target, title: this.notes.get(target)?.title ?? path.posix.basename(target, ".md"), rawTarget: target, line: index + 1 }));
    return { path: input.path, links, total: links.length, limited: false };
  }

  async backlinks(input: PathCommandInput): Promise<BacklinksCommandResult> {
    this.calls.push({ method: "backlinks", input });
    const backlinks = [] as Array<{ path: string; title: string; matchedTarget: string; line: number; context: string }>;
    for (const note of this.notes.values()) {
      if ((note.links ?? []).includes(input.path)) backlinks.push({ path: note.path, title: note.title, matchedTarget: input.path, line: 1, context: `${note.title} links to ${input.path}` });
    }
    return { path: input.path, backlinks, total: backlinks.length, limited: false };
  }

  async recents(): Promise<RecentsCommandResult> {
    this.calls.push({ method: "recents" });
    const recents = [...this.notes.values()]
      .filter((note) => note.openedAt)
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))
      .map((note) => ({ path: note.path, title: note.title, openedAt: note.openedAt }));
    return { recents, total: recents.length, limited: false };
  }

  private matchingNotes(query: string, folder?: string): FakeNote[] {
    return [...this.notes.values()]
      .filter((note) => !folder || note.path.startsWith(`${folder.replace(/\/$/, "")}/`))
      .filter((note) => noteMatches(note, query))
      .sort((a, b) => scoreText(b, query) - scoreText(a, query) || a.path.localeCompare(b.path));
  }
}

export function seededFakeCli(): FakeObsidianCliBackend {
  const cli = new FakeObsidianCliBackend();
  cli.addNote({
    path: "Research/Integrated Gradients/index.md",
    title: "Integrated Gradients",
    aliases: ["IG", "Integrated Attribution"],
    tags: ["attribution", "interpretability"],
    properties: { project: "Interpretability", status: "active", owner: "Ada" },
    modified: "2026-04-20T10:00:00Z",
    openedAt: "2026-04-28T10:00:00Z",
    links: ["Research/Integrated Gradients/Roadmap.md", "Papers/Axiomatic Attribution.md"],
    content: "# Integrated Gradients\nCore note about integrated gradients for attribution.\n## Overview\nCompare expected gradients and saliency maps.\n## Implementation\nUse path integral baselines and attribution tests.",
  });
  cli.addNote({
    path: "Research/Integrated Gradients/Roadmap.md",
    title: "Integrated Gradients Roadmap",
    aliases: ["IG Roadmap"],
    tags: ["attribution", "roadmap"],
    properties: { project: "Interpretability", status: "planning" },
    modified: "2026-04-22T10:00:00Z",
    links: ["Research/Integrated Gradients/index.md"],
    content: "# Roadmap\n## Month 1\nRead attribution papers.\n## Month 3\nShip integrated gradients demo and write evaluation notes.",
  });
  cli.addNote({
    path: "Research/Integrated Gradients/Per-Step IG.md",
    title: "Per-Step Integrated Gradients",
    aliases: ["Per-Step IG"],
    tags: ["per-step"],
    properties: { status: "draft", technique: "per-step attribution" },
    links: ["Research/Integrated Gradients/index.md"],
    content: "# Per-Step Integrated Gradients\nPer-step integrated gradients records attribution at each optimization step.\n## Procedure\nCompute per-step integrated gradients and compare the step attribution deltas.",
  });
  cli.addNote({
    path: "MOCs/Integrated Gradients MOC.md",
    title: "Integrated Gradients MOC",
    aliases: ["IG MOC"],
    tags: ["moc", "attribution"],
    properties: { project: "Interpretability", hub: "MOC" },
    links: ["Research/Integrated Gradients/index.md", "Research/Integrated Gradients/Per-Step IG.md"],
    content: "# Integrated Gradients MOC\nMap of content for integrated gradients research.\n## Connections\nLinks to per-step integrated gradients, axiomatic attribution, and roadmap notes.",
  });
  cli.addNote({
    path: "MOCs/CS EE MOC.md",
    title: "CS EE MOC",
    aliases: ["Computer Science Electrical Engineering MOC"],
    tags: ["moc", "cs", "ee"],
    properties: { hub: "General CS EE" },
    content: "# CS EE MOC\nGeneral MOC for computer science and electrical engineering notes.\n## Connections\nBroad connections around courses, systems, and hardware.",
  });
  cli.addNote({
    path: "Papers/Axiomatic Attribution.md",
    title: "Axiomatic Attribution",
    tags: ["paper", "attribution"],
    properties: { project: "Interpretability", year: 2017 },
    links: ["Research/Integrated Gradients/index.md"],
    content: "# Axiomatic Attribution\nPaper notes for integrated gradients and attribution axioms.",
  });
  cli.addNote({
    path: "Projects/Pi Obsidian Harness.md",
    title: "Pi Obsidian Harness",
    aliases: ["POH", "Obsidian Retrieval Harness"],
    tags: ["pi", "obsidian", "retrieval"],
    properties: { project: "Pi", status: "active" },
    modified: "2026-04-23T10:00:00Z",
    openedAt: "2026-04-29T09:00:00Z",
    links: ["Projects/Pi Obsidian Harness/Architecture.md"],
    content: "# Pi Obsidian Harness\nCandidate-first retrieval powered by the official Obsidian CLI.\n## Architecture\nUse CLI discovery, ranking, and bounded context packing.",
  });
  cli.addNote({
    path: "Projects/Pi Obsidian Harness/Architecture.md",
    title: "Retrieval Architecture",
    tags: ["pi", "architecture"],
    properties: { project: "Pi", status: "draft" },
    links: ["Projects/Pi Obsidian Harness.md"],
    content: "# Retrieval Architecture\n## CLI Adapter\nAll discovery flows through read-only Obsidian CLI commands.\n## Context Packer\nNever dump a folder or full vault.",
  });
  cli.addNote({
    path: "Projects/Project Narrative.md",
    title: "Project Narrative",
    aliases: ["Narrative"],
    tags: ["project", "narrative"],
    properties: { project: "Pi", status: "active" },
    content: "# Project Narrative\nThis note introduces the project narrative and why the work matters.\n## Background\nThis section says what the project is without timeline details. It has general context and information.\n## Progress Timeline\nThe project progressed from smoke testing to retrieval ranking hardening. Progress milestones include fixing weak token matches, improving confidence, and refining context section selection.\n## Current State\nThe current project state is a safe read-only retrieval extension with candidate-first context selection.",
  });
  cli.addNote({
    path: "Projects/Alpha Ranking Quality.md",
    title: "Ranking Quality Alpha",
    aliases: ["Ranking Alpha"],
    tags: ["ranking", "quality"],
    properties: { project: "Ranking", status: "active" },
    content: "# Ranking Quality Alpha\nStrong candidate about ranking quality ambiguity.",
  });
  cli.addNote({
    path: "Projects/Beta Ranking Quality.md",
    title: "Ranking Quality Beta",
    aliases: ["Ranking Beta"],
    tags: ["ranking", "quality"],
    properties: { project: "Ranking", status: "active" },
    content: "# Ranking Quality Beta\nStrong candidate about ranking quality ambiguity.",
  });
  cli.addNote({
    path: "Archive/WeakBody.md",
    title: "Weak Body Baseline",
    tags: ["archive"],
    properties: { status: "archived" },
    content: "# Weak Body Baseline\nLegacy note with weak body content but a distinctive filename.",
  });
  cli.addNote({
    path: "Archive/Per Token Distractor.md",
    title: "Per Token Distractor",
    tags: ["archive"],
    properties: { status: "archived" },
    content: `# Per Token Distractor\n${"per ".repeat(80)}This note repeats only the isolated weak token and is unrelated to attribution.`,
  });
  return cli;
}

export const knownFailedQueries = [
  { query: "graidents", expectedPath: "Research/Integrated Gradients/index.md", category: "fuzzy_title" },
  { query: "IG", expectedPath: "Research/Integrated Gradients/index.md", category: "alias" },
  { query: "Interpretability", expectedPath: "Research/Integrated Gradients/index.md", category: "property" },
  { query: "Month 3", expectedPath: "Research/Integrated Gradients/Roadmap.md", category: "heading" },
  { query: "Obsidian Retrieval Harness", expectedPath: "Projects/Pi Obsidian Harness.md", category: "alias" },
  { query: "per-step integrated gradients", expectedPath: "Research/Integrated Gradients/Per-Step IG.md", category: "phrase_title" },
];

export const baselineFirstResponseChars = 25_000;

function fileItem(note: FakeNote): { path: string; name: string; modified?: string; size: number } {
  const item: { path: string; name: string; modified?: string; size: number } = { path: note.path, name: note.title, size: note.content.length };
  if (note.modified) item.modified = note.modified;
  return item;
}

function noteMatches(note: FakeNote, query: string): boolean {
  const text = [note.title, note.path, note.content, ...(note.aliases ?? []), ...(note.tags ?? []), ...Object.entries(note.properties ?? {}).flatMap(([k, v]) => [k, String(v)])].join(" ");
  return fuzzyIncludes(text, query);
}

function scoreText(note: FakeNote, query: string): number {
  const q = query.toLowerCase();
  if (sameTitle(note.title, query)) return 100;
  if (note.aliases?.some((alias) => sameTitle(alias, query))) return 95;
  if (note.tags?.some((tag) => normalizeTag(tag) === normalizeTag(q))) return 80;
  if (Object.entries(note.properties ?? {}).some(([key, value]) => key.toLowerCase().includes(q) || String(value).toLowerCase().includes(q))) return 75;
  if (note.path.toLowerCase().includes(q)) return 70;
  if (note.content.toLowerCase().includes(q)) return 55;
  if (fuzzyIncludes(note.title, query)) return 50;
  return 1;
}

function fuzzyIncludes(value: string, query: string): boolean {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase().replace(/^#/, "");
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const terms = needle.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every((term) => haystack.includes(term))) return true;
  return compactDistance(haystack, needle) <= Math.max(1, Math.floor(needle.length / 3));
}

function sameTitle(value: string, query: string): boolean {
  return value.toLowerCase() === query.toLowerCase();
}

function normalizeTag(value: string): string {
  return value.replace(/^#/, "").toLowerCase();
}

function compactDistance(value: string, query: string): number {
  const compactValue = value.replace(/[^a-z0-9]/g, "");
  const compactQuery = query.replace(/[^a-z0-9]/g, "");
  if (compactValue.includes(compactQuery)) return 0;
  const windowSize = compactQuery.length;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= Math.max(0, compactValue.length - windowSize); index += 1) {
    best = Math.min(best, levenshtein(compactValue.slice(index, index + windowSize), compactQuery));
  }
  return best;
}

function levenshtein(a: string, b: string): number {
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
