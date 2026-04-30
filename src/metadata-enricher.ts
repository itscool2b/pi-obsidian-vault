import path from "node:path";
import type { CandidateMetadata, CandidateSeed, HeadingSummary, LinkSummary, BacklinkSummary, ObsidianCliBackend } from "./retrieval-types.js";

export interface EnrichedCandidateSeed extends CandidateSeed {
  title: string;
  metadata: CandidateMetadata;
}

export async function enrichCandidateMetadata(backend: ObsidianCliBackend, seeds: CandidateSeed[], options: { metadataItems: number; hydrateRelationships?: boolean }): Promise<EnrichedCandidateSeed[]> {
  const aliasMap = await aliasesByPath(backend).catch(() => new Map<string, string[]>());
  const tagMap = await tagsByPath(backend).catch(() => new Map<string, string[]>());
  const propertyMap = await propertiesByPath(backend).catch(() => new Map<string, Record<string, unknown>>());
  const recentSet = await recentPaths(backend).catch(() => new Set<string>());

  return Promise.all(seeds.map(async (seed) => {
    const metadata: CandidateMetadata = {};
    const aliases = aliasMap.get(seed.path)?.slice(0, options.metadataItems);
    if (aliases && aliases.length > 0) metadata.aliases = aliases;
    const tags = tagMap.get(seed.path)?.slice(0, options.metadataItems);
    if (tags && tags.length > 0) metadata.tags = tags;
    const properties = propertyMap.get(seed.path);
    if (properties && Object.keys(properties).length > 0) metadata.properties = limitObject(properties, options.metadataItems);
    if (recentSet.has(seed.path)) metadata.recent = true;

    let title = seed.title ?? titleFromPath(seed.path);
    try {
      const info = await backend.file({ path: seed.path });
      title = info.name ?? titleFromPath(info.path);
      if (info.modified) metadata.modified = info.modified;
      if (info.size !== undefined) metadata.size = info.size;
    } catch {
      // Keep title fallback.
    }

    try {
      const outline = await backend.outline({ path: seed.path });
      const headings: HeadingSummary[] = outline.headings.slice(0, options.metadataItems).map((heading) => {
        const item: HeadingSummary = { text: heading.text };
        if (heading.level !== undefined) item.level = heading.level;
        if (heading.line !== undefined) item.line = heading.line;
        return item;
      });
      if (headings.length > 0) metadata.headings = headings;
    } catch {
      // Outline is a quality signal, not required.
    }

    if (options.hydrateRelationships) {
      try {
        const links = await backend.links({ path: seed.path });
        const summaries: LinkSummary[] = links.links.slice(0, options.metadataItems).map((link) => {
          const summary: LinkSummary = { reason: "outgoing link" };
          if (link.path) summary.path = link.path;
          if (link.title) summary.title = link.title;
          if (link.rawTarget) summary.rawTarget = link.rawTarget;
          if (link.line !== undefined) summary.line = link.line;
          return summary;
        });
        if (summaries.length > 0) metadata.links = summaries;
      } catch {
        // optional
      }
      try {
        const backlinks = await backend.backlinks({ path: seed.path });
        const summaries: BacklinkSummary[] = backlinks.backlinks.slice(0, options.metadataItems).map((backlink) => {
          const summary: BacklinkSummary = { path: backlink.path, reason: "backlink" };
          if (backlink.title) summary.title = backlink.title;
          if (backlink.matchedTarget) summary.matchedTarget = backlink.matchedTarget;
          if (backlink.line !== undefined) summary.line = backlink.line;
          if (backlink.context) summary.context = backlink.context;
          return summary;
        });
        if (summaries.length > 0) metadata.backlinks = summaries;
      } catch {
        // optional
      }
    }

    return { ...seed, title, metadata };
  }));
}

export function metadataCoverage(candidates: EnrichedCandidateSeed[]): number {
  if (candidates.length === 0) return 100;
  const covered = candidates.filter((candidate) => Boolean(candidate.title && candidate.path && candidate.metadata)).length;
  return Math.round((covered / candidates.length) * 100);
}

function titleFromPath(notePath: string): string {
  return path.posix.basename(notePath, path.posix.extname(notePath));
}

function limitObject(input: Record<string, unknown>, max: number): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).slice(0, max));
}

async function aliasesByPath(backend: ObsidianCliBackend): Promise<Map<string, string[]>> {
  const result = await backend.aliases({});
  const map = new Map<string, string[]>();
  for (const alias of result.aliases) {
    for (const notePath of alias.paths) {
      const list = map.get(notePath) ?? [];
      list.push(alias.alias);
      map.set(notePath, list);
    }
  }
  return map;
}

async function tagsByPath(backend: ObsidianCliBackend): Promise<Map<string, string[]>> {
  const result = await backend.tags({ counts: true });
  const map = new Map<string, string[]>();
  for (const tag of result.tags) {
    for (const notePath of tag.paths ?? []) {
      const list = map.get(notePath) ?? [];
      list.push(tag.tag);
      map.set(notePath, list);
    }
  }
  return map;
}

async function propertiesByPath(backend: ObsidianCliBackend): Promise<Map<string, Record<string, unknown>>> {
  const result = await backend.properties({ counts: true });
  const map = new Map<string, Record<string, unknown>>();
  for (const property of result.properties) {
    for (const notePath of property.paths ?? []) {
      const object = map.get(notePath) ?? {};
      object[property.name] = property.value ?? true;
      map.set(notePath, object);
    }
  }
  return map;
}

async function recentPaths(backend: ObsidianCliBackend): Promise<Set<string>> {
  const result = await backend.recents();
  return new Set(result.recents.map((recent) => recent.path));
}
