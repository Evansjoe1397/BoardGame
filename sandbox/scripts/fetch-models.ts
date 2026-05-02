/**
 * Fetch a curated set of low-poly .glb models from Sketchfab into
 * public/sandbox/models/ for the sandbox FPS scene.
 *
 * Run:  bun run sandbox/scripts/fetch-models.ts
 *
 * The Sketchfab API token is read from SKETCHFAB_TOKEN env var.
 * Free CC-licensed models only; license info is recorded into CREDITS.json.
 */

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.SKETCHFAB_TOKEN;
if (!TOKEN) {
  console.error('Set SKETCHFAB_TOKEN env var.');
  process.exit(1);
}

const OUT_DIR = 'public/sandbox/models';
const CREDITS_PATH = join(OUT_DIR, 'CREDITS.json');

const HEADERS = { Authorization: `Token ${TOKEN}` };

interface SearchResult {
  uid: string;
  name: string;
  faceCount: number;
  vertexCount: number;
  isDownloadable: boolean;
  license: { label: string; slug: string } | null;
  user: { username: string; displayName: string };
  viewerUrl: string;
  archives: {
    glb?: { size: number; faceCount: number };
    gltf?: { size: number };
  };
  price?: number | null;
}

interface Query {
  slug: string;          // file name (without .glb)
  query: string;         // search query
  maxFaces?: number;     // skip results above this
  minFaces?: number;
  preferUid?: string;    // override picker with a specific uid
}

const QUERIES: Query[] = [
  { slug: 'tree',     query: 'low poly tree',           maxFaces: 8000 },
  { slug: 'rock',     query: 'low poly rock',           maxFaces: 5000 },
  { slug: 'mushroom', query: 'low poly mushroom',       maxFaces: 6000 },
  { slug: 'crate',    query: 'low poly wooden crate',   maxFaces: 4000 },
  { slug: 'barrel',   query: 'low poly barrel',         maxFaces: 5000 },
  { slug: 'fox',      query: 'low poly fox',            maxFaces: 8000 },
];

async function search(q: string): Promise<SearchResult[]> {
  const url = new URL('https://api.sketchfab.com/v3/search');
  url.searchParams.set('type', 'models');
  url.searchParams.set('downloadable', 'true');
  url.searchParams.set('q', q);
  url.searchParams.set('count', '24');
  url.searchParams.set('sort_by', '-likeCount');
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`search failed ${res.status}`);
  const data = await res.json() as { results: SearchResult[] };
  return data.results ?? [];
}

function pick(results: SearchResult[], q: Query): SearchResult | null {
  for (const r of results) {
    if (!r.isDownloadable) continue;
    if (r.price && r.price > 0) continue;
    if (!r.archives?.glb) continue;
    if (q.maxFaces && r.faceCount > q.maxFaces) continue;
    if (q.minFaces && r.faceCount < q.minFaces) continue;
    if (r.archives.glb.size > 25 * 1024 * 1024) continue; // <25 MB
    return r;
  }
  return null;
}

async function getDownloadUrl(uid: string): Promise<string> {
  const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: HEADERS });
  if (!res.ok) throw new Error(`download endpoint failed ${res.status}`);
  const data = await res.json() as { glb?: { url: string } };
  if (!data.glb?.url) throw new Error('no glb flavor in download response');
  return data.glb.url;
}

async function downloadGlb(url: string, dest: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch glb failed ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.byteLength;
}

interface CreditsEntry {
  slug: string;
  uid: string;
  name: string;
  author: string;
  license: string;
  source: string;
  faceCount: number;
  bytes: number;
}

async function loadCredits(): Promise<CreditsEntry[]> {
  if (!existsSync(CREDITS_PATH)) return [];
  try {
    return JSON.parse(await readFile(CREDITS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

async function saveCredits(entries: CreditsEntry[]): Promise<void> {
  await writeFile(CREDITS_PATH, JSON.stringify(entries, null, 2));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const credits = await loadCredits();
  const seen = new Set(credits.map(c => c.slug));

  for (const q of QUERIES) {
    const dest = join(OUT_DIR, `${q.slug}.glb`);
    if (existsSync(dest) && seen.has(q.slug)) {
      const s = await stat(dest);
      console.log(`[skip] ${q.slug} already present (${(s.size / 1024).toFixed(0)} KB)`);
      continue;
    }

    console.log(`[search] "${q.query}"`);
    const results = await search(q.query);
    const picked = pick(results, q);
    if (!picked) {
      console.warn(`  no match for "${q.query}"`);
      continue;
    }
    console.log(`  picked: ${picked.name} (${picked.faceCount} faces, ${picked.user.displayName})`);

    try {
      const url = await getDownloadUrl(picked.uid);
      const bytes = await downloadGlb(url, dest);
      console.log(`  saved ${dest} (${(bytes / 1024).toFixed(0)} KB)`);

      // upsert credits
      const entry: CreditsEntry = {
        slug: q.slug,
        uid: picked.uid,
        name: picked.name,
        author: picked.user.displayName || picked.user.username,
        license: picked.license?.label ?? 'unknown',
        source: picked.viewerUrl,
        faceCount: picked.faceCount,
        bytes,
      };
      const i = credits.findIndex(c => c.slug === q.slug);
      if (i >= 0) credits[i] = entry; else credits.push(entry);
      await saveCredits(credits);
    } catch (e) {
      console.error(`  download failed:`, (e as Error).message);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
