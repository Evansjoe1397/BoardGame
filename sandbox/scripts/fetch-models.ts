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
  animated?: boolean;    // require animations
  preferUid?: string;    // override picker with a specific uid
  excludeUids?: string[]; // uids to skip (already tried, didn't fit)
}

// Past picks that didn't visually fit (kept here so re-fetches don't pick them again).
const EXCLUDE_TREE: string[] = []; // tree pick is OK
const EXCLUDE_SWORD: string[] = []; // populate via `list weapon_sword` then re-fetch
const EXCLUDE_ANIM: string[] = [];

const QUERIES: Query[] = [
  // PeterMikielewicz "Asteroid with minerals" — proper asteroid mesh
  { slug: 'asteroid',   query: 'asteroid with minerals',    maxFaces: 20000,
                        preferUid: '1cf93f26dbc34a08a31367ea8929117f' },
  { slug: 'rock',       query: 'low poly rock',             maxFaces: 5000 },
  // Cransh "Animated FPS hands (rifle animation pack)" — full FPS rig with arms,
  // 8 separate animations (idle/fire/reload/etc), CC-BY. ~14MB.
  { slug: 'fps_rifle',  query: 'animated FPS hands rifle',  maxFaces: 50000, animated: true,
                        preferUid: '5f2d0ed780a94724b36ab505f7564057' },
  // Jazba "Terror Engine - Medusa" — single rigged enemy, 5 animations,
  // CC-BY, textured. Single-character glb avoids the pack-animation
  // bone-resolution issues we hit with Polyart Zombies.
  { slug: 'monster',    query: 'terror engine medusa',      maxFaces: 25000, animated: true,
                        preferUid: 'ca8cb5485de84c4ea4642240ea8307fc' },
  // DibArts "Wyvern" — winged flying creature, animated
  { slug: 'flier',      query: 'wyvern animated',           maxFaces: 8000, animated: true,
                        preferUid: 'b3b83f40265347dd90e4666c3e2a843c' },

  // 360° HDRI skydome (space nebula) — the sphere itself is trivially low-poly,
  // the asset weight is in the panoramic texture. Used as an alternate sky in
  // the sandbox (toggle with `B`).
  { slug: 'skydome',  query: 'space nebula HDRI panorama 360 skydome', maxFaces: 200000,
                      preferUid: '255203215c394bdb947c718b46515120' },

  // Plasma projectile model used in place of a plain white sphere when fliers fire.
  { slug: 'projectile', query: 'astro projectile',                    maxFaces: 30000,
                        preferUid: 'fea1d82dcd524373b6971a19b2450b07' },

  // Ambient creatures populating the SECOND asteroid. Single looping clip
  // (Take 001) plays continuously while they hover.
  { slug: 'eyebeast',   query: 'eyebeast animated',                    maxFaces: 60000, animated: true,
                        preferUid: 'b458af2e4e6f4c61849ad4e1d69e89b1' },

  // Spider-thing walkers on the SECOND asteroid (chase + attack). Clips:
  //   subjectAction  — walk/run loop
  //   ArmatureAction — attack lunge
  { slug: 'spider',       query: 'spiderthing take 3',                  maxFaces: 80000, animated: true,
                          preferUid: '10bb4cf49d304d64afd2b829666f6caf' },

  // Third (purely decorative) asteroid orbiting in the player's sky — Toutatis.
  { slug: 'asteroid_far', query: 'toutatis asteroid earth impactor',    maxFaces: 80000,
                          preferUid: '5446cb4764674e49a5e4eda95ed497dc' },

  // Hostile creature populating the THIRD asteroid. Clips: Idle / Run / Attack1 / Die.
  { slug: 'tribrute',     query: 'monster',                             maxFaces: 80000, animated: true,
                          preferUid: '71cc330a586441d985a95c08bea6a510' },

  // Flying enemy on the THIRD asteroid. Clips: Idle / FastFly / Attack2 / Death1 / Death2.
  { slug: 'bat',          query: 'dark bat',                            maxFaces: 60000, animated: true,
                          preferUid: 'aaf83921207b4c13b1f30649b5225af5' },

  // (kept for potential future reuse, but the minimal scene only needs the three above)
  { slug: 'tree',     query: 'low poly tree',           maxFaces: 8000, excludeUids: EXCLUDE_TREE },
  { slug: 'mushroom', query: 'low poly mushroom',       maxFaces: 6000 },
];

// CLI: --refetch=slug1,slug2 forces re-download (skipping the already-present check)
const refetchArg = process.argv.find(a => a.startsWith('--refetch='));
const REFETCH = new Set(refetchArg ? refetchArg.slice('--refetch='.length).split(',') : []);
if (REFETCH.size) console.log(`[refetch] forcing re-download for: ${[...REFETCH].join(', ')}`);

async function search(q: string, animated = false): Promise<SearchResult[]> {
  const url = new URL('https://api.sketchfab.com/v3/search');
  url.searchParams.set('type', 'models');
  url.searchParams.set('downloadable', 'true');
  if (animated) url.searchParams.set('animated', 'true');
  url.searchParams.set('q', q);
  url.searchParams.set('count', '24');
  url.searchParams.set('sort_by', '-likeCount');
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`search failed ${res.status}`);
  const data = await res.json() as { results: SearchResult[] };
  return data.results ?? [];
}

function pick(results: SearchResult[], q: Query): SearchResult | null {
  const exclude = new Set(q.excludeUids ?? []);
  // honour preferUid if it's in the result set
  if (q.preferUid) {
    const explicit = results.find(r => r.uid === q.preferUid);
    if (explicit) return explicit;
  }
  for (const r of results) {
    if (exclude.has(r.uid)) continue;
    if (!r.isDownloadable) continue;
    if (r.price && r.price > 0) continue;
    if (!r.archives?.glb) continue;
    if (q.maxFaces && r.faceCount > q.maxFaces) continue;
    if (q.minFaces && r.faceCount < q.minFaces) continue;
    if (r.archives.glb.size > 60 * 1024 * 1024) continue; // 60 MB cap
    return r;
  }
  return null;
}

async function fetchModelByUid(uid: string): Promise<SearchResult | null> {
  // direct lookup so preferUid works even if it falls outside the top search results.
  const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}`, { headers: HEADERS });
  if (!res.ok) return null;
  return await res.json() as SearchResult;
}

async function listCandidates(slug: string): Promise<void> {
  const q = QUERIES.find(x => x.slug === slug);
  if (!q) { console.error(`No query for slug "${slug}"`); process.exit(1); }
  console.log(`[list] candidates for "${q.query}":`);
  const results = await search(q.query, q.animated);
  const exclude = new Set(q.excludeUids ?? []);
  let n = 0;
  for (const r of results) {
    if (n >= 12) break;
    const flags: string[] = [];
    if (exclude.has(r.uid))                               flags.push('EXCL');
    if (!r.isDownloadable)                                flags.push('!dl');
    if (r.price && r.price > 0)                          flags.push('paid');
    if (!r.archives?.glb)                                 flags.push('!glb');
    if (q.maxFaces && r.faceCount > q.maxFaces)           flags.push('>faces');
    if (q.minFaces && r.faceCount < q.minFaces)           flags.push('<faces');
    if (r.archives?.glb && r.archives.glb.size > 25 * 1024 * 1024) flags.push('>25MB');
    const mark = flags.length === 0 ? '✓' : '✗';
    console.log(`  ${mark} ${r.uid}  ${(r.faceCount + '').padStart(6)} faces  ${flags.join(',').padEnd(12)}  ${r.user.displayName} — ${r.name}`);
    n++;
  }
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
  // CLI: `list <slug>` — print top candidates for that slug and exit.
  if (process.argv[2] === 'list' && process.argv[3]) {
    await listCandidates(process.argv[3]);
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const credits = await loadCredits();
  const seen = new Set(credits.map(c => c.slug));

  for (const q of QUERIES) {
    const dest = join(OUT_DIR, `${q.slug}.glb`);
    if (existsSync(dest) && seen.has(q.slug) && !REFETCH.has(q.slug)) {
      const s = await stat(dest);
      console.log(`[skip] ${q.slug} already present (${(s.size / 1024).toFixed(0)} KB)`);
      continue;
    }

    let picked: SearchResult | null = null;
    // preferUid is authoritative: hit the model endpoint directly so we
    // never accidentally pick something else just because the chosen model
    // isn't in the search top-likes (the previous behaviour grabbed a
    // random "Flying Dragon" instead of the Lizardmon).
    if (q.preferUid) {
      console.log(`[direct] ${q.preferUid}`);
      picked = await fetchModelByUid(q.preferUid);
      if (picked) console.log(`  picked (direct): ${picked.name}`);
    }
    if (!picked) {
      console.log(`[search] "${q.query}"${q.animated ? ' (animated)' : ''}`);
      const results = await search(q.query, q.animated);
      picked = pick(results, q);
    }
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
