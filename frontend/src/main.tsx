import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Safe API base URL resolution for both Vite builds and standalone preview sandboxes
const getApiBase = (): string => {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> })?.env;
    if (metaEnv?.VITE_API_URL) {
      return metaEnv.VITE_API_URL.replace(/\/+$/, '');
    }
  } catch {
    // Fallback when import.meta is unavailable in target environment
  }
  return 'http://localhost:8000';
};

const API_BASE = getApiBase();

// --- Types ---
export interface Section {
  heading: string;
  content: string;
}

export interface Resource {
  name: string;
  url: string;
  kind: string;
  description?: string;
}

export interface Entry {
  id: number;
  title: string;
  category: string;
  subcategory: string;
  source: string;
  sourceUrl: string;
  summary: string;
  notes: string;
  image: string;
  favorite: boolean;
  tags: string[];
  sections: Section[];
  resources: Resource[];
  createdAt: string;
}

type EntryPayload = Omit<Entry, 'id' | 'createdAt'>;
type Draft = Omit<Entry, 'id' | 'createdAt' | 'favorite' | 'tags'> & { tags: string };

// --- API Client Functions ---
function mapEntryFromApi(raw: Record<string, unknown>): Entry {
  return {
    id: Number(raw.id),
    title: String(raw.title || ''),
    category: String(raw.category || 'General'),
    subcategory: raw.subcategory ? String(raw.subcategory) : '',
    source: String(raw.source || 'Manual'),
    sourceUrl: String(raw.source_url ?? raw.sourceUrl ?? ''),
    summary: String(raw.summary || ''),
    notes: String(raw.notes || ''),
    image: String(raw.image || ''),
    favorite: Boolean(raw.favorite),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    sections: Array.isArray(raw.sections) ? (raw.sections as Section[]) : [],
    resources: Array.isArray(raw.resources) ? (raw.resources as Resource[]) : [],
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  };
}

function mapEntryToApi(payload: Partial<EntryPayload>) {
  return {
    title: payload.title,
    category: payload.category,
    subcategory: payload.subcategory || null,
    source: payload.source || 'Manual',
    source_url: payload.sourceUrl || '',
    summary: payload.summary || '',
    notes: payload.notes || '',
    image: payload.image || '',
    favorite: Boolean(payload.favorite),
    tags: payload.tags || [],
    sections: payload.sections || [],
    resources: payload.resources || [],
  };
}

async function fetchEntries(): Promise<Entry[]> {
  const res = await fetch(`${API_BASE}/entries`);
  if (!res.ok) throw new Error('Failed to fetch entries');
  const data = await res.json();
  return Array.isArray(data) ? data.map(mapEntryFromApi) : [];
}

async function createEntry(payload: EntryPayload): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapEntryToApi(payload)),
  });
  if (!res.ok) throw new Error('Failed to create entry');
  return mapEntryFromApi(await res.json());
}

async function updateEntry(id: number, payload: Partial<EntryPayload>): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapEntryToApi(payload)),
  });
  if (!res.ok) throw new Error('Failed to update entry');
  return mapEntryFromApi(await res.json());
}

async function toggleFavoriteApi(id: number): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries/${id}/favorite`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to toggle favorite');
  return mapEntryFromApi(await res.json());
}

async function deleteEntryApi(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/entries/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete entry');
}

async function fetchUrlMeta(url: string): Promise<{ title: string; summary: string; source: string }> {
  const res = await fetch(`${API_BASE}/fetch-meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error('Failed to fetch URL metadata');
  return res.json();
}

// --- Smart Engine (Offline Auto-Tagging & Synonym Search) ---
const CATEGORY_RULES: { category: string; subcategory?: string; keywords: string[] }[] = [
  { category: 'Technology', subcategory: 'Python', keywords: ['python', 'fastapi', 'django', 'pandas', 'pytorch', 'pip'] },
  { category: 'Technology', subcategory: 'Web Dev', keywords: ['react', 'typescript', 'javascript', 'html', 'css', 'vite', 'node', 'api', 'github', 'frontend', 'backend'] },
  { category: 'Technology', subcategory: 'AI & Data', keywords: ['ai', 'llm', 'ollama', 'machine learning', 'neural', 'chatgpt', 'gemini', 'sql', 'database'] },
  { category: 'Finance', subcategory: 'Trading & Investing', keywords: ['forex', 'stock', 'mutual fund', 'trading', 'gold', 'nifty', 'crypto', 'dividend', 'investment', 'tax', 'budget'] },
  { category: 'Skincare', keywords: ['skincare', 'acne', 'pimple', 'serum', 'niacinamide', 'sunscreen', 'moisturizer', 'cleanser', 'oily skin', 'retinol'] },
  { category: 'Haircare', keywords: ['hair', 'shampoo', 'dandruff', 'hairfall', 'scalp', 'conditioner', 'haircut'] },
  { category: 'Fitness', keywords: ['workout', 'exercise', 'gym', 'protein', 'muscle', 'cardio', 'calories', 'weight loss', 'pushup', 'squat'] },
  { category: 'Food', keywords: ['recipe', 'cook', 'dish', 'ingredients', 'puttu', 'curry', 'masala', 'fry', 'kitchen', 'meal'] },
  { category: 'Education', subcategory: 'Exams & Study', keywords: ['tnpsc', 'exam', 'syllabus', 'interview', 'aptitude', 'polity', 'history', 'coursera', 'roadmap', 'study'] },
  { category: 'Fashion', keywords: ['outfit', 'shirt', 'jeans', 'style', 'fashion', 'shoes', 'wardrobe'] },
  { category: 'Entertainment', keywords: ['movie', 'series', 'song', 'music', 'spotify', 'cricket', 'ipl', 'trailer'] },
];

const SYNONYM_GROUPS: string[][] = [
  ['acne', 'pimple', 'pimples', 'breakout', 'blemish'],
  ['js', 'javascript', 'ecmascript'],
  ['ts', 'typescript'],
  ['py', 'python'],
  ['workout', 'exercise', 'training', 'gym', 'fitness'],
  ['money', 'finance', 'budget', 'investing', 'investment', 'stocks'],
  ['exam', 'test', 'tnpsc', 'preparation', 'study'],
  ['hairfall', 'hair loss', 'thinning'],
  ['food', 'recipe', 'cooking', 'dish'],
  ['ui', 'design', 'css', 'frontend'],
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'did', 'save', 'saved',
  'about', 'how', 'to', 'in', 'on', 'of', 'a', 'an', 'is', 'are', 'my', 'me', 'best',
]);

function smartOrganize(input: {
  title: string;
  source: string;
  sourceUrl: string;
  summary: string;
  notes: string;
  tags: string;
}) {
  const combined = `${input.title} ${input.summary} ${input.notes} ${input.sourceUrl}`.toLowerCase();
  let matchedCategory = '';
  let matchedSubcategory = '';
  const detectedTags = new Set<string>(
    input.tags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  );

  const inlineHashtags = `${input.summary} ${input.notes}`.match(/#[a-zA-Z0-9_-]{2,25}/g) || [];
  inlineHashtags.forEach(h => detectedTags.add(h.slice(1).toLowerCase()));

  for (const rule of CATEGORY_RULES) {
    const hits = rule.keywords.filter(kw => combined.includes(kw));
    if (hits.length > 0) {
      if (!matchedCategory) {
        matchedCategory = rule.category;
        matchedSubcategory = rule.subcategory || '';
      }
      hits.slice(0, 3).forEach(h => detectedTags.add(h.replace(/\s+/g, '-')));
    }
  }

  if (input.source && input.source !== 'Manual') {
    detectedTags.add(input.source.toLowerCase());
  }

  const autoSummary =
    input.summary.trim() ||
    input.notes
      .trim()
      .split(/[.!\n]/)[0]
      ?.slice(0, 180) ||
    '';

  return {
    category: matchedCategory || 'Other',
    subcategory: matchedSubcategory,
    summary: autoSummary,
    tags: [...detectedTags].slice(0, 6).join(', '),
  };
}

function expandTokens(query: string): string[] {
  const rawTokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  const expanded = new Set<string>(rawTokens);
  for (const token of rawTokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(token)) {
        group.forEach(syn => expanded.add(syn));
      }
    }
  }
  return [...expanded];
}

function smartSearch(entries: Entry[], query: string): { entry: Entry; score: number; matchedOn: string[] }[] {
  const tokens = expandTokens(query);
  if (!tokens.length) return [];

  const scored: { entry: Entry; score: number; matchedOn: string[] }[] = [];

  for (const entry of entries) {
    let score = 0;
    const matchedOn = new Set<string>();

    const title = entry.title.toLowerCase();
    const tags = entry.tags.join(' ').toLowerCase();
    const category = `${entry.category} ${entry.subcategory}`.toLowerCase();
    const summary = entry.summary.toLowerCase();
    const notes = entry.notes.toLowerCase();
    const sections = entry.sections.map(s => `${s.heading} ${s.content}`).join(' ').toLowerCase();

    for (const token of tokens) {
      if (title.includes(token)) {
        score += 5;
        matchedOn.add('Title');
      }
      if (tags.includes(token)) {
        score += 4;
        matchedOn.add('Tags');
      }
      if (category.includes(token)) {
        score += 3;
        matchedOn.add('Category');
      }
      if (summary.includes(token)) {
        score += 2;
        matchedOn.add('Summary');
      }
      if (notes.includes(token) || sections.includes(token)) {
        score += 1;
        matchedOn.add('Notes');
      }
    }

    if (score > 0) {
      scored.push({ entry, score, matchedOn: [...matchedOn] });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 6);
}

// --- Embedded Styles (styles.css + extras.css + mobile polish) ---
const EMBEDDED_CSS = `
:root{font-family:Inter,system-ui,sans-serif;color:#173126;background:#f6f8f3}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:hidden;max-width:100%}
.shell{min-height:100vh;display:grid;grid-template-columns:238px 1fr}
aside{background:#183b2d;color:#eaf5ee;padding:27px 16px;display:flex;flex-direction:column;gap:20px}
.brand{font-size:25px;font-weight:850;letter-spacing:-1.3px;padding:0 10px}
.brand span{color:#91d3a9}
.brand small{display:block;font-weight:500;letter-spacing:0;color:#b4c9bc;font-size:11px;margin-top:4px}
nav{display:grid;gap:4px}
aside button{font:inherit;border:0;background:transparent;color:#d9e7dd;text-align:left;cursor:pointer;border-radius:8px;padding:10px 11px}
aside button:hover,aside .selected{background:#2b5944;color:#fff}
.side-label{color:#91aa9a;font-weight:800;font-size:10px;letter-spacing:.09em;padding:5px 11px}
.category-list{display:grid;gap:2px;max-height:320px;overflow:auto}
.category-list button{display:flex;justify-content:space-between}
.category-list span{color:#a9c5b3;font-size:12px}
.quick{background:#9ad9ad!important;color:#143523!important;font-weight:800!important;text-align:center!important;margin-top:auto}
main{max-width:1260px;width:100%;margin:auto;padding:34px 42px 70px}
header{display:flex;justify-content:space-between;align-items:center;gap:20px}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;color:#678176;margin:0 0 6px}
h1{font-size:30px;letter-spacing:-1px;margin:0}
h2{font-size:20px;letter-spacing:-.5px;margin:0}
h3{margin:7px 0;font-size:17px}
.primary,.secondary,.text-button{border:0;border-radius:9px;font:inherit;cursor:pointer;font-weight:750}
.primary{background:#23734d;color:white;padding:11px 16px}
.secondary{background:#e5f0e7;color:#216142;padding:10px 13px}
.intro{display:flex;justify-content:space-between;align-items:end;background:linear-gradient(110deg,#e0efe3,#f7f9f5);margin:28px 0 16px;padding:27px;border-radius:15px}
.intro h2{font-size:25px}
.intro p{color:#65766b;margin:7px 0 0}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.metric{background:#fff;border:1px solid #d9e3da;border-radius:12px;padding:17px}
.metric strong{font-size:25px;display:block}
.metric span{font-size:12px;color:#738278}
.recent{margin-top:32px}
.section-head,.controls,.modal-title,.repeat-head,.modal-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.text-button{color:#23734d;background:transparent}
.entry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-top:13px}
.entry-card,.empty{background:#fff;border:1px solid #d9e3da;border-radius:13px;padding:17px}
.entry-card{position:relative;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}
.entry-card:hover{transform:translateY(-2px);border-color:#9fc9ad;box-shadow:0 8px 22px #17312612}
.card-actions{position:absolute;right:9px;top:8px;display:flex;gap:2px}
.card-actions button,.close,.delete-row{border:0;background:transparent;color:#789084;font-size:19px;cursor:pointer;padding:4px}
.card-actions button:first-child{color:#d6972f}
.entry-card h3{margin-right:70px}
.summary{font-size:13px;color:#506258;min-height:39px}
.card-section{border-left:3px solid #b9d8c1;font-size:12px;padding-left:8px;margin-top:8px;display:grid;gap:2px}
.card-section span{color:#5c6c62}
.chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:12px}
.chips i{font-style:normal;font-size:11px;background:#e8f3ea;color:#23734d;border-radius:12px;padding:3px 6px}
.resource-count{margin-top:12px;color:#637a6c;font-size:12px}
.controls{margin:28px 0 6px}
.controls input,.controls select{border:1px solid #cddbd0;border-radius:9px;padding:11px;background:white;font:inherit}
.controls input{flex:1}
.controls span{font-size:13px;color:#6e7e73}
.empty{grid-column:1/-1;text-align:center;padding:55px;color:#68796d}
.toast{position:fixed;right:25px;bottom:25px;z-index:4;background:#1d6845;color:white;padding:12px 16px;border-radius:9px;box-shadow:0 8px 26px #1234;font-size:13px}
.overlay{position:fixed;inset:0;background:#102e2188;display:grid;place-items:center;padding:18px;z-index:5}
.modal{background:#fff;width:min(735px,100%);max-height:92vh;overflow:auto;border-radius:16px;padding:25px}
.modal h2{font-size:23px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.field{display:block;font-size:12px;font-weight:750;margin:13px 0 0}
.field span{display:block;margin-bottom:5px}
.field input,.field select,.field textarea,.repeat-row input,.repeat-row select{width:100%;font:inherit;border:1px solid #ccd9cf;border-radius:8px;padding:10px;background:#fff}
.field textarea{min-height:68px;resize:vertical}
.repeat-head{margin-top:20px}
.repeat-head h3{font-size:15px}
.small{font-size:12px;padding:7px 9px}
.repeat-row{display:grid;grid-template-columns:1fr 1.45fr auto;gap:7px;margin-top:7px}
.repeat-row.resource{grid-template-columns:120px 1fr 1.25fr auto}
.delete-row{background:#faeeee;color:#a44742;border-radius:7px}
.modal-actions{justify-content:flex-end;margin-top:25px}
.ask-panel{margin:28px 0 18px;padding:24px;border:1px solid #cfe2d4;border-radius:14px;background:#edf6ee}
.ask-panel p{color:#5c7164}
.ask-panel input{width:100%;margin:10px 0;border:1px solid #c4d8c9;border-radius:9px;padding:12px;font:inherit}
.ask-results{display:grid;gap:7px;margin-top:13px}
.ask-results button{text-align:left;border:1px solid #d1e2d4;background:white;border-radius:9px;padding:11px;cursor:pointer;color:#214735;font:inherit}
.ask-results button span{display:block;color:#23734d;font-size:10px;font-weight:800;text-transform:uppercase}
.ask-results small{display:block;color:#6b7d70;margin-top:3px}
.image-preview{display:block;max-width:180px;max-height:140px;object-fit:cover;border-radius:9px;margin-top:9px}
.detail-image{width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin:16px 0;border:1px solid #dce6de}
.detail-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 16px;font-size:12px;color:#5c7164}
.detail-source-link{display:inline-flex;align-items:center;gap:5px;color:#23734d;font-weight:750;text-decoration:none;background:#e8f3ea;padding:5px 10px;border-radius:8px}
.detail-block{margin-top:18px}
.detail-block h4{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#678176;margin:0 0 6px}
.detail-block p{margin:0;line-height:1.6;color:#243d32;white-space:pre-wrap;font-size:14px}
.detail-sections{display:grid;gap:10px;margin-top:18px}
.detail-section-item{background:#f6f9f6;border-left:3px solid #23734d;padding:12px 14px;border-radius:0 10px 10px 0}
.detail-section-item b{display:block;font-size:13px;color:#173126;margin-bottom:4px}
.detail-section-item span{font-size:13.5px;color:#4a5d53;line-height:1.5;white-space:pre-wrap}
.resource-links{display:grid;gap:8px;margin-top:8px}
.resource-link-card{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 14px;border:1px solid #d5e3d8;border-radius:10px;text-decoration:none;color:#173126;background:#fff}
.resource-link-card strong{font-size:13.5px;display:block}
.resource-link-card small{color:#678176;font-size:11.5px;word-break:break-all}
.resource-badge{font-size:10px;font-weight:800;text-transform:uppercase;background:#e5f0e7;color:#216142;padding:4px 8px;border-radius:6px;white-space:nowrap}
.mobile-nav{display:none}
.backup-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.backup-actions button{background:#214a39;color:#cbe0d3;font-size:12px;text-align:center;padding:8px 6px}
.url-fetch-row{display:grid;grid-template-columns:1fr auto;gap:8px}
.ai-answer-box{margin-top:14px;padding:16px;border-radius:11px;background:#fff;border:1px solid #b9d8c1}
.ai-answer-box h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#23734d}
.ai-answer-box p{margin:0;color:#173126;font-size:14px;line-height:1.6;white-space:pre-wrap}
.rediscover-card{margin-top:16px;background:#fff;border:1px solid #d9e3da;border-radius:14px;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;cursor:pointer}
.rediscover-card h3{margin:4px 0;font-size:16px}
.rediscover-card p{margin:0;color:#5c6c62;font-size:13px}
.dup-warning{margin-top:8px;padding:10px 12px;border-radius:8px;background:#fff6e0;border:1px solid #ecd08c;color:#6e4e08;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.dup-warning button{border:0;background:#6e4e08;color:#fff;border-radius:6px;padding:5px 9px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.bookmarklet-box{background:#214a39;border-radius:9px;padding:9px 10px;font-size:11px;color:#cbe0d3;display:grid;gap:6px}
.bookmarklet-box button{background:#2f634d;color:#fff;font-size:11.5px;font-weight:700;text-align:center;padding:6px;border-radius:6px}
.related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px}
.related-card{text-align:left;border:1px solid #d5e3d8;background:#f8fbf8;border-radius:10px;padding:10px 12px;cursor:pointer;font:inherit;color:#173126}
.related-card span{display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:#23734d;margin-bottom:3px}
.related-card strong{display:block;font-size:13px;line-height:1.35}
@media(max-width:900px){
  .shell{display:block!important;width:100%}
  aside{display:none!important}
  .mobile-nav{display:flex;gap:6px;overflow-x:auto;background:#183b2d;padding:10px 14px;position:sticky;top:0;z-index:4;width:100%}
  .mobile-nav button{font:inherit;font-size:13px;font-weight:650;border:0;background:transparent;color:#d9e7dd;padding:8px 12px;border-radius:8px;white-space:nowrap;cursor:pointer}
  .mobile-nav button.selected{background:#2b5944;color:#fff}
  main{width:100%;max-width:100%;padding:20px 16px 56px}
  .entry-grid{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:600px){
  header{align-items:flex-start}
  header h1{font-size:25px}
  .intro,.rediscover-card{display:block}
  .intro .secondary{margin-top:17px}
  .metrics{grid-template-columns:repeat(2,1fr)}
  .entry-grid{grid-template-columns:1fr}
  .controls{flex-wrap:wrap}
  .controls input{min-width:100%}
  .form-grid{grid-template-columns:1fr}
  .url-fetch-row,.dup-warning{grid-template-columns:1fr;flex-direction:column;align-items:stretch}
  .repeat-row,.repeat-row.resource{grid-template-columns:1fr 1fr auto}
  .repeat-row.resource select{grid-column:1/-1}
  .modal{padding:18px}
}
`;

// Sample demo entries shown only if the backend is offline during preview
const DEMO_ENTRIES: Entry[] = [
  {
    id: 1,
    title: 'FastAPI + SQLite Production Deployment Checklist',
    category: 'Technology',
    subcategory: 'Python',
    source: 'Website',
    sourceUrl: 'https://fastapi.tiangolo.com',
    summary: 'Key patterns for deploying FastAPI with CORS, health checks, and environment-based API keys.',
    notes: 'Remember to set FRONTEND_URL and GEMINI_API_KEY in Render environment variables.',
    image: '',
    favorite: true,
    tags: ['python', 'fastapi', 'render', 'api'],
    sections: [
      { heading: 'CORS Setup', content: 'Allow both localhost:5173 and the deployed frontend origin.' },
    ],
    resources: [
      { name: 'FastAPI Docs', url: 'https://fastapi.tiangolo.com', kind: 'Website' },
    ],
    createdAt: new Date().toISOString(),
  },
];

const newDraft = (): Draft => ({
  title: '',
  category: 'Technology',
  subcategory: '',
  source: 'Instagram',
  sourceUrl: '',
  summary: '',
  notes: '',
  image: '',
  tags: '',
  sections: [{ heading: '', content: '' }],
  resources: [],
});

function detectSourceFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('medium.com') || lower.includes('substack.com')) return 'Article';
  return 'Website';
}

function formatEntryMarkdown(entry: Entry): string {
  return [
    `# ${entry.title}`,
    `**Category:** ${entry.category}${entry.subcategory ? ` > ${entry.subcategory}` : ''}  `,
    `**Source:** ${entry.source}${entry.sourceUrl ? ` ([Link](${entry.sourceUrl}))` : ''}  `,
    `**Saved:** ${new Date(entry.createdAt).toLocaleDateString()}`,
    entry.tags.length ? `**Tags:** ${entry.tags.map(t => `#${t}`).join(' ')}` : '',
    entry.summary ? `\n## Key Summary\n${entry.summary}` : '',
    entry.notes ? `\n## Personal Notes\n${entry.notes}` : '',
    ...entry.sections.map(s => `\n## ${s.heading}\n${s.content}`),
    entry.resources.length
      ? `\n## Saved Resources\n${entry.resources.map(r => `- **[${r.name}](${r.url})** (${r.kind})`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [page, setPage] = useState<'dashboard' | 'manage' | 'favorites' | 'ask'>('dashboard');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [draft, setDraft] = useState<Draft>(newDraft());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingEntry, setViewingEntry] = useState<Entry | null>(null);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [toast, setToast] = useState('');
  const [ask, setAsk] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [askingAi, setAskingAi] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [gemSeed, setGemSeed] = useState(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const message = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 3400);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewingEntry(null);
        setModal(false);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPage('manage');
        window.setTimeout(() => searchInputRef.current?.focus(), 20);
      } else if (e.key === '/' && !isTyping && !modal && !viewingEntry) {
        e.preventDefault();
        setPage('manage');
        window.setTimeout(() => searchInputRef.current?.focus(), 20);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, viewingEntry]);

  useEffect(() => {
    let active = true;
    fetchEntries()
      .then(data => {
        if (active) {
          setEntries(data);
          setApiError('');
        }
      })
      .catch(() => {
        if (active) {
          setEntries(DEMO_ENTRIES);
          setApiError(`Preview Mode: Backend at ${API_BASE} is offline (showing sample entry).`);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const params = new URLSearchParams(window.location.search);
    const captureUrl = params.get('captureUrl');
    const captureTitle = params.get('captureTitle') || '';
    if (captureUrl) {
      const source = detectSourceFromUrl(captureUrl);
      const organized = smartOrganize({
        title: captureTitle,
        source,
        sourceUrl: captureUrl,
        summary: '',
        notes: '',
        tags: '',
      });
      setDraft({
        ...newDraft(),
        title: captureTitle,
        source,
        sourceUrl: captureUrl,
        category: organized.category,
        subcategory: organized.subcategory,
        tags: organized.tags,
      });
      setModal(true);
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => {
      active = false;
    };
  }, []);

  const categories = [...new Set(entries.map(e => e.category))].sort();

  const shown = useMemo(
    () =>
      entries
        .filter(
          e =>
            (filter === 'All' || e.category === filter) &&
            JSON.stringify(e).toLowerCase().includes(query.toLowerCase()) &&
            (page !== 'favorites' || e.favorite)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [entries, filter, query, page]
  );

  const relatedEntries = useMemo(() => {
    if (!viewingEntry) return [];
    const viewTags = new Set(viewingEntry.tags.map(t => t.toLowerCase()));
    return entries
      .filter(e => e.id !== viewingEntry.id)
      .map(e => {
        const sharedTags = e.tags.filter(t => viewTags.has(t.toLowerCase())).length;
        const sameCategory = e.category === viewingEntry.category ? 1 : 0;
        return { entry: e, score: sharedTags * 3 + sameCategory };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => x.entry);
  }, [viewingEntry, entries]);

  const duplicateEntry = useMemo(() => {
    const clean = draft.sourceUrl.trim().toLowerCase().replace(/\/+$/, '');
    if (!clean) return null;
    return (
      entries.find(
        e => e.id !== editingId && e.sourceUrl.trim().toLowerCase().replace(/\/+$/, '') === clean
      ) || null
    );
  }, [draft.sourceUrl, entries, editingId]);

  const rediscoverGem = useMemo(() => {
    if (entries.length < 2) return null;
    const idx = (entries.length + gemSeed) % entries.length;
    return entries[idx];
  }, [entries, gemSeed]);

  const openCreate = () => {
    setDraft(newDraft());
    setEditingId(null);
    setViewingEntry(null);
    setModal(true);
  };

  const openEdit = (entry: Entry) => {
    setViewingEntry(null);
    setEditingId(entry.id);
    setDraft({
      ...entry,
      tags: entry.tags.join(', '),
      sections: entry.sections.length ? entry.sections : [{ heading: '', content: '' }],
    });
    setModal(true);
  };

  const setField = (name: keyof Draft, value: string) => setDraft(old => ({ ...old, [name]: value }));

  const updateSection = (index: number, key: keyof Section, value: string) =>
    setDraft(old => ({
      ...old,
      sections: old.sections.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
    }));

  const updateResource = (index: number, key: keyof Resource, value: string) =>
    setDraft(old => ({
      ...old,
      resources: old.resources.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    }));

  const runSmartRuleOrganize = () => {
    if (!draft.title && !draft.summary && !draft.notes && !draft.sourceUrl) {
      message('Add a title, link, or notes first.');
      return;
    }
    const result = smartOrganize(draft);
    setDraft(old => ({
      ...old,
      category: result.category,
      subcategory: result.subcategory || old.subcategory,
      summary: old.summary || result.summary,
      tags: result.tags || old.tags,
    }));
    message('Auto-categorized & tagged using Smart Rules!');
  };

  const handleFetchLink = async () => {
    if (!draft.sourceUrl.trim()) {
      message('Paste a source link first.');
      return;
    }
    setFetchingMeta(true);
    try {
      const meta = await fetchUrlMeta(draft.sourceUrl);
      const nextTitle = meta.title || draft.title;
      const nextSummary = meta.summary || draft.summary;
      const nextSource = meta.source || draft.source;
      const organized = smartOrganize({
        title: nextTitle,
        source: nextSource,
        sourceUrl: draft.sourceUrl,
        summary: nextSummary,
        notes: draft.notes,
        tags: draft.tags,
      });
      setDraft(old => ({
        ...old,
        source: nextSource,
        title: nextTitle,
        summary: nextSummary,
        category: organized.category,
        subcategory: organized.subcategory || old.subcategory,
        tags: organized.tags || old.tags,
      }));
      message(meta.title ? 'Fetched link info & auto-tagged!' : 'Detected source & updated tags.');
    } catch {
      const detected = detectSourceFromUrl(draft.sourceUrl);
      setField('source', detected);
      message(`Detected ${detected} link.`);
    } finally {
      setFetchingMeta(false);
    }
  };

  const copyBookmarklet = () => {
    const appOrigin = window.location.origin;
    const code = `javascript:void((function(){var u=new URL('${appOrigin}');u.searchParams.set('captureUrl',location.href);u.searchParams.set('captureTitle',document.title);window.open(u.toString(),'_blank');})())`;
    navigator.clipboard.writeText(code);
    message('Bookmarklet copied! Create a browser bookmark and paste this as its URL.');
  };

  const copyEntryText = (entry: Entry) => {
    navigator.clipboard.writeText(formatEntryMarkdown(entry));
    message('Copied Markdown note to clipboard!');
  };

  const downloadEntryMarkdown = (entry: Entry) => {
    const md = formatEntryMarkdown(entry);
    const slug =
      entry.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'savesense-note';
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
    message(`Downloaded ${slug}.md`);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `savesense-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message(`Exported ${entries.length} entries.`);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Invalid backup format.');
      let imported = 0;
      const newlyCreated: Entry[] = [];
      for (const item of parsed) {
        if (!item?.title || !item?.category) continue;
        const created = await createEntry({
          title: String(item.title),
          category: String(item.category),
          subcategory: item.subcategory ? String(item.subcategory) : '',
          source: item.source ? String(item.source) : 'Manual',
          sourceUrl: item.sourceUrl ? String(item.sourceUrl) : '',
          summary: item.summary ? String(item.summary) : '',
          notes: item.notes ? String(item.notes) : '',
          image: item.image ? String(item.image) : '',
          favorite: Boolean(item.favorite),
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
          sections: Array.isArray(item.sections)
            ? item.sections.filter((s: Section) => s?.heading && s?.content)
            : [],
          resources: Array.isArray(item.resources)
            ? item.resources.filter((r: Resource) => r?.name && r?.url)
            : [],
        });
        newlyCreated.push(created);
        imported++;
      }
      setEntries(prev => [...newlyCreated, ...prev]);
      message(`Imported ${imported} entries into database.`);
    } catch {
      message('Could not import file. Make sure it is a valid SaveSense JSON backup.');
    } finally {
      e.target.value = '';
    }
  };

  const analyzeDraftWithAi = async () => {
    if (!draft.title && !draft.summary && !draft.notes && !draft.sourceUrl) {
      message('Add a title, link, summary, or notes before analyzing.');
      return;
    }
    setAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE}/ai/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          url: draft.sourceUrl,
          notes: [draft.summary, draft.notes].filter(Boolean).join('\n'),
        }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setDraft(old => ({
        ...old,
        category: result.category || old.category,
        summary: result.summary || old.summary,
        tags: Array.isArray(result.tags) && result.tags.length ? result.tags.join(', ') : old.tags,
        sections: Array.isArray(result.sections) && result.sections.length ? result.sections : old.sections,
      }));
      message('Gemini AI draft ready—review before saving.');
    } catch {
      runSmartRuleOrganize();
      message('Cloud AI offline—used instant Smart Rules instead!');
    } finally {
      setAnalyzing(false);
    }
  };

  const askKnowledgeWithAi = async (e: FormEvent) => {
    e.preventDefault();
    if (!ask.trim()) return;
    if (!entries.length) {
      message('Save some entries first before asking questions.');
      return;
    }
    setAskingAi(true);
    setAiAnswer('');
    try {
      const response = await fetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: ask }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAiAnswer(data.answer || 'No response from AI.');
    } catch {
      message('Cloud AI offline—showing Smart Ranked matches below.');
    } finally {
      setAskingAi(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const payload: EntryPayload = {
      ...draft,
      favorite: editingId ? Boolean(entries.find(e => e.id === editingId)?.favorite) : false,
      tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      sections: draft.sections.filter(s => s.heading.trim() && s.content.trim()),
      resources: draft.resources.filter(r => r.name.trim() && r.url.trim()),
    };
    try {
      if (editingId) {
        const updated = await updateEntry(editingId, payload);
        setEntries(prev => prev.map(e => (e.id === editingId ? updated : e)));
        message('Entry updated.');
      } else {
        const created = await createEntry(payload);
        setEntries(prev => [created, ...prev]);
        message('Knowledge saved to database.');
      }
      setModal(false);
    } catch {
      if (editingId) {
        setEntries(prev =>
          prev.map(e => (e.id === editingId ? { ...e, ...payload, id: editingId } : e))
        );
        message('Updated in local preview.');
      } else {
        const localEntry: Entry = {
          ...payload,
          id: Date.now(),
          createdAt: new Date().toISOString(),
        };
        setEntries(prev => [localEntry, ...prev]);
        message('Saved in local preview.');
      }
      setModal(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteEntryApi(id);
    } catch {
      // Allow local state cleanup even if preview backend is offline
    }
    setEntries(prev => prev.filter(e => e.id !== id));
    if (viewingEntry?.id === id) setViewingEntry(null);
    message('Entry deleted.');
  };

  const favorite = async (id: number) => {
    try {
      const updated = await toggleFavoriteApi(id);
      setEntries(prev => prev.map(e => (e.id === id ? updated : e)));
      if (viewingEntry?.id === id) setViewingEntry(updated);
    } catch {
      setEntries(prev =>
        prev.map(e => (e.id === id ? { ...e, favorite: !e.favorite } : e))
      );
      if (viewingEntry?.id === id) {
        setViewingEntry({ ...viewingEntry, favorite: !viewingEntry.favorite });
      }
    }
  };

  const manage = () => {
    setPage('manage');
    setFilter('All');
    setQuery('');
  };

  const filterByTag = (tag: string) => {
    setViewingEntry(null);
    setPage('manage');
    setFilter('All');
    setQuery(tag);
  };

  const totalResources = entries.reduce((count, entry) => count + entry.resources.length, 0);
  const rankedAnswers = useMemo(() => smartSearch(entries, ask), [ask, entries]);

  return (
    <>
      <style>{EMBEDDED_CSS}</style>
      <div className="shell">
        <div className="mobile-nav">
          <button className={page === 'dashboard' ? 'selected' : ''} onClick={() => setPage('dashboard')}>
            ◫ Dashboard
          </button>
          <button className={page === 'manage' ? 'selected' : ''} onClick={manage}>
            ▤ Manage
          </button>
          <button className={page === 'favorites' ? 'selected' : ''} onClick={() => setPage('favorites')}>
            ★ Favorites
          </button>
          <button className={page === 'ask' ? 'selected' : ''} onClick={() => setPage('ask')}>
            ✦ Search & Ask
          </button>
        </div>

        <aside>
          <div className="brand">
            Save<span>Sense</span>
            <small>Personal knowledge hub</small>
          </div>
          <nav>
            <button className={page === 'dashboard' ? 'selected' : ''} onClick={() => setPage('dashboard')}>
              ◫ Dashboard
            </button>
            <button className={page === 'manage' ? 'selected' : ''} onClick={manage}>
              ▤ Manage entries
            </button>
            <button className={page === 'favorites' ? 'selected' : ''} onClick={() => setPage('favorites')}>
              ★ Favorites
            </button>
            <button className={page === 'ask' ? 'selected' : ''} onClick={() => setPage('ask')}>
              ✦ Ask my knowledge
            </button>
          </nav>
          <div className="side-label">CATEGORIES</div>
          <div className="category-list">
            <button
              className={filter === 'All' ? 'selected' : ''}
              onClick={() => {
                setFilter('All');
                setPage('manage');
              }}
            >
              All knowledge <span>{entries.length}</span>
            </button>
            {categories.map(c => (
              <button
                key={c}
                className={filter === c ? 'selected' : ''}
                onClick={() => {
                  setFilter(c);
                  setPage('manage');
                }}
              >
                {c}
                <span>{entries.filter(e => e.category === c).length}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <div className="bookmarklet-box">
              <span>1-Click Web Clipper</span>
              <button type="button" onClick={copyBookmarklet}>
                + Copy Bookmarklet
              </button>
            </div>
            <div className="backup-actions">
              <button type="button" onClick={exportBackup} title="Download JSON backup">
                ↓ Export
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()} title="Restore JSON backup">
                ↑ Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleImport}
              />
            </div>
            <button className="quick" style={{ marginTop: 0 }} onClick={openCreate}>
              ＋ Quick Capture
            </button>
          </div>
        </aside>

        <main>
          <header>
            <div>
              <p className="eyebrow">
                {page === 'dashboard'
                  ? 'OVERVIEW'
                  : page === 'favorites'
                  ? 'SAVED FOR LATER'
                  : page === 'ask'
                  ? 'SMART SEARCH & Q&A'
                  : 'KNOWLEDGE LIBRARY'}
              </p>
              <h1>
                {page === 'dashboard'
                  ? 'Welcome back.'
                  : page === 'favorites'
                  ? 'Your favorites'
                  : page === 'ask'
                  ? 'Ask your knowledge'
                  : 'Manage your entries'}
              </h1>
            </div>
            <button className="primary" onClick={openCreate}>
              + Add entry
            </button>
          </header>

          {apiError && (
            <div
              style={{
                marginTop: 18,
                padding: '12px 16px',
                borderRadius: 10,
                background: '#fff6e0',
                color: '#6e4e08',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ℹ {apiError}
            </div>
          )}

          {toast && <div className="toast">✓ {toast}</div>}

          {page === 'ask' && (
            <section className="ask-panel">
              <h2>What have you saved?</h2>
              <p>Instant synonym-aware search works automatically as you type—plus Gemini AI synthesis.</p>
              <form
                onSubmit={askKnowledgeWithAi}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}
              >
                <input
                  style={{ margin: 0 }}
                  value={ask}
                  onChange={e => {
                    setAsk(e.target.value);
                    setAiAnswer('');
                  }}
                  placeholder="e.g. What did I save about pimples or oily skin?"
                />
                <button type="submit" className="secondary" disabled={askingAi}>
                  {askingAi ? 'Thinking…' : '✦ Summarize with AI'}
                </button>
              </form>

              {aiAnswer && (
                <div className="ai-answer-box">
                  <h4>✦ Gemini AI Summary from Your Notes</h4>
                  <p>{aiAnswer}</p>
                </div>
              )}

              {ask && (
                <div className="ask-results">
                  <b>
                    {rankedAnswers.length
                      ? `Top ${rankedAnswers.length} ranked matches`
                      : 'No matching saved entries yet.'}
                  </b>
                  {rankedAnswers.map(({ entry, matchedOn }) => (
                    <button key={entry.id} onClick={() => setViewingEntry(entry)}>
                      <span>
                        {entry.category} · Matched in {matchedOn.join(', ')}
                      </span>
                      {entry.title}
                      <small>{entry.summary || entry.notes}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {loading ? (
            <div className="empty" style={{ marginTop: 24 }}>
              <h3>Loading your knowledge base…</h3>
            </div>
          ) : page === 'dashboard' ? (
            <>
              <section className="intro">
                <div>
                  <h2>Everything useful, finally findable.</h2>
                  <p>Capture discoveries from Instagram, YouTube, websites, and anywhere else.</p>
                </div>
                <button className="secondary" onClick={openCreate}>
                  Capture something useful →
                </button>
              </section>
              <section className="metrics">
                <Metric value={entries.length} label="Knowledge entries" />
                <Metric value={categories.length} label="Categories" />
                <Metric value={entries.filter(e => e.favorite).length} label="Favorites" />
                <Metric value={totalResources} label="Resources" />
              </section>

              {rediscoverGem && (
                <div className="rediscover-card" onClick={() => setViewingEntry(rediscoverGem)}>
                  <div>
                    <p className="eyebrow">✦ REDISCOVER A SAVED GEM · {rediscoverGem.category}</p>
                    <h3>{rediscoverGem.title}</h3>
                    <p>{rediscoverGem.summary || rediscoverGem.notes || 'Click to review this saved discovery.'}</p>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={e => {
                      e.stopPropagation();
                      setGemSeed(s => s + 1);
                    }}
                  >
                    ↻ Shuffle
                  </button>
                </div>
              )}

              <section className="recent">
                <div className="section-head">
                  <h2>Recently added</h2>
                  <button className="text-button" onClick={manage}>
                    Manage all →
                  </button>
                </div>
                <EntryGrid
                  entries={shown.slice(0, 6)}
                  onView={setViewingEntry}
                  onEdit={openEdit}
                  onDelete={remove}
                  onFavorite={favorite}
                  onTagClick={filterByTag}
                />
              </section>
            </>
          ) : (
            <>
              <section className="controls">
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search titles, notes, tags, resources… (Ctrl+K)"
                />
                <select value={filter} onChange={e => setFilter(e.target.value)}>
                  <option>All</option>
                  {categories.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span>
                  {shown.length} result{shown.length === 1 ? '' : 's'}
                </span>
              </section>
              <EntryGrid
                entries={shown}
                onView={setViewingEntry}
                onEdit={openEdit}
                onDelete={remove}
                onFavorite={favorite}
                onTagClick={filterByTag}
              />
            </>
          )}
        </main>

        {/* Read-Only Entry Detail Modal */}
        {viewingEntry && (
          <div className="overlay" onClick={() => setViewingEntry(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">
                <div>
                  <p className="eyebrow">
                    {viewingEntry.category}
                    {viewingEntry.subcategory ? ` · ${viewingEntry.subcategory}` : ''}
                  </p>
                  <h2>{viewingEntry.title}</h2>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="close"
                    title="Favorite"
                    style={{ color: '#d6972f' }}
                    onClick={() => favorite(viewingEntry.id)}
                  >
                    {viewingEntry.favorite ? '★' : '☆'}
                  </button>
                  <button type="button" className="secondary small" onClick={() => copyEntryText(viewingEntry)}>
                    ⧉ Copy
                  </button>
                  <button type="button" className="secondary small" onClick={() => downloadEntryMarkdown(viewingEntry)}>
                    ↓ .md
                  </button>
                  <button type="button" className="secondary small" onClick={() => openEdit(viewingEntry)}>
                    ✎ Edit
                  </button>
                  <button type="button" className="close" onClick={() => setViewingEntry(null)}>
                    ×
                  </button>
                </div>
              </div>

              <div className="detail-meta">
                <span>
                  Captured from <strong>{viewingEntry.source}</strong>
                </span>
                <span>•</span>
                <span>{new Date(viewingEntry.createdAt).toLocaleDateString()}</span>
                {viewingEntry.sourceUrl && (
                  <a
                    className="detail-source-link"
                    href={viewingEntry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open original source ↗
                  </a>
                )}
              </div>

              {viewingEntry.image && (
                <img className="detail-image" src={viewingEntry.image} alt={viewingEntry.title} />
              )}

              {viewingEntry.summary && (
                <div className="detail-block">
                  <h4>Key Summary</h4>
                  <p>{viewingEntry.summary}</p>
                </div>
              )}

              {viewingEntry.notes && (
                <div className="detail-block">
                  <h4>Personal Notes</h4>
                  <p>{viewingEntry.notes}</p>
                </div>
              )}

              {viewingEntry.sections.length > 0 && (
                <div className="detail-sections">
                  {viewingEntry.sections.map((section, idx) => (
                    <div className="detail-section-item" key={idx}>
                      <b>{section.heading}</b>
                      <span>{section.content}</span>
                    </div>
                  ))}
                </div>
              )}

              {viewingEntry.resources.length > 0 && (
                <div className="detail-block">
                  <h4>Saved Resources ({viewingEntry.resources.length})</h4>
                  <div className="resource-links">
                    {viewingEntry.resources.map((res, idx) => (
                      <a
                        key={idx}
                        className="resource-link-card"
                        href={res.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <div>
                          <strong>{res.name} ↗</strong>
                          <small>{res.url}</small>
                        </div>
                        <span className="resource-badge">{res.kind}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {viewingEntry.tags.length > 0 && (
                <div className="chips" style={{ marginTop: 18 }}>
                  {viewingEntry.tags.map(tag => (
                    <i
                      key={tag}
                      style={{ cursor: 'pointer' }}
                      title={`Filter by #${tag}`}
                      onClick={() => filterByTag(tag)}
                    >
                      #{tag}
                    </i>
                  ))}
                </div>
              )}

              {relatedEntries.length > 0 && (
                <div className="detail-block">
                  <h4>Related Saved Entries</h4>
                  <div className="related-grid">
                    {relatedEntries.map(rel => (
                      <button
                        key={rel.id}
                        type="button"
                        className="related-card"
                        onClick={() => setViewingEntry(rel)}
                      >
                        <span>{rel.category}</span>
                        <strong>{rel.title}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  style={{ color: '#a44742', background: '#faeeee' }}
                  onClick={() => remove(viewingEntry.id)}
                >
                  Delete
                </button>
                <button type="button" className="primary" onClick={() => setViewingEntry(null)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create / Edit Modal */}
        {modal && (
          <div className="overlay">
            <form className="modal" onSubmit={submit}>
              <div className="modal-title">
                <div>
                  <p className="eyebrow">{editingId ? 'EDIT ENTRY' : 'QUICK CAPTURE'}</p>
                  <h2>{editingId ? 'Update knowledge' : 'Save a useful discovery'}</h2>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={runSmartRuleOrganize}
                    style={{
                      border: 0,
                      borderRadius: '9px',
                      padding: '9px 12px',
                      background: '#9ad9ad',
                      color: '#143523',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✦ Smart Auto-Tag
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={analyzeDraftWithAi}
                    disabled={analyzing}
                    title="Auto-draft summary, category, and tags with Gemini AI"
                  >
                    {analyzing ? 'AI…' : '✦ AI Draft'}
                  </button>
                  <button type="button" className="close" onClick={() => setModal(false)}>
                    ×
                  </button>
                </div>
              </div>

              <Field label="Source link (paste URL & auto-fill)">
                <div className="url-fetch-row">
                  <input
                    type="url"
                    value={draft.sourceUrl}
                    onChange={e => setField('sourceUrl', e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or article link"
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleFetchLink}
                    disabled={fetchingMeta}
                  >
                    {fetchingMeta ? 'Fetching…' : '↓ Fetch Info'}
                  </button>
                </div>
                {duplicateEntry && (
                  <div className="dup-warning">
                    <span>
                      ⚠ Already saved under <strong>&quot;{duplicateEntry.title}&quot;</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setModal(false);
                        setViewingEntry(duplicateEntry);
                      }}
                    >
                      View Existing
                    </button>
                  </div>
                )}
              </Field>

              <div className="form-grid">
                <Field label="Title">
                  <input
                    required
                    value={draft.title}
                    onChange={e => setField('title', e.target.value)}
                    placeholder="What did you find?"
                  />
                </Field>
                <Field label="Source">
                  <select value={draft.source} onChange={e => setField('source', e.target.value)}>
                    <option>Instagram</option>
                    <option>YouTube</option>
                    <option>Website</option>
                    <option>Article</option>
                    <option>Manual</option>
                  </select>
                </Field>
                <Field label="Category">
                  <input
                    required
                    value={draft.category}
                    onChange={e => setField('category', e.target.value)}
                    placeholder="Technology, Finance…"
                  />
                </Field>
                <Field label="Subcategory">
                  <input
                    value={draft.subcategory}
                    onChange={e => setField('subcategory', e.target.value)}
                    placeholder="Python, Forex…"
                  />
                </Field>
              </div>

              <Field label="Image (optional)">
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => setField('image', String(reader.result));
                      reader.readAsDataURL(file);
                    }
                  }}
                />
                {draft.image && <img className="image-preview" src={draft.image} alt="Entry preview" />}
              </Field>
              <Field label="Summary">
                <textarea
                  value={draft.summary}
                  onChange={e => setField('summary', e.target.value)}
                  placeholder="The important takeaway in your own words…"
                />
              </Field>
              <Field label="Personal notes">
                <textarea
                  value={draft.notes}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Anything you want to remember or try… (use #hashtags to auto-tag)"
                />
              </Field>
              <Field label="Tags">
                <input
                  value={draft.tags}
                  onChange={e => setField('tags', e.target.value)}
                  placeholder="python, beginner, youtube"
                />
              </Field>
              <div className="repeat-head">
                <h3>Dynamic sections</h3>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    setDraft(old => ({ ...old, sections: [...old.sections, { heading: '', content: '' }] }))
                  }
                >
                  + Add section
                </button>
              </div>
              {draft.sections.map((section, index) => (
                <div className="repeat-row" key={index}>
                  <input
                    value={section.heading}
                    onChange={e => updateSection(index, 'heading', e.target.value)}
                    placeholder="Heading (e.g. Recommended channels)"
                  />
                  <input
                    value={section.content}
                    onChange={e => updateSection(index, 'content', e.target.value)}
                    placeholder="Details"
                  />
                  {draft.sections.length > 1 && (
                    <button
                      type="button"
                      className="delete-row"
                      onClick={() =>
                        setDraft(old => ({ ...old, sections: old.sections.filter((_, i) => i !== index) }))
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <div className="repeat-head">
                <h3>Resources</h3>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    setDraft(old => ({ ...old, resources: [...old.resources, { name: '', url: '', kind: 'Website' }] }))
                  }
                >
                  + Add resource
                </button>
              </div>
              {draft.resources.map((resource, index) => (
                <div className="repeat-row resource" key={index}>
                  <select value={resource.kind} onChange={e => updateResource(index, 'kind', e.target.value)}>
                    <option>Website</option>
                    <option>YouTube</option>
                    <option>GitHub</option>
                    <option>Article</option>
                    <option>Product</option>
                  </select>
                  <input
                    value={resource.name}
                    onChange={e => updateResource(index, 'name', e.target.value)}
                    placeholder="Resource name"
                  />
                  <input
                    type="url"
                    value={resource.url}
                    onChange={e => updateResource(index, 'url', e.target.value)}
                    placeholder="https://…"
                  />
                  <button
                    type="button"
                    className="delete-row"
                    onClick={() =>
                      setDraft(old => ({ ...old, resources: old.resources.filter((_, i) => i !== index) }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setModal(false)}>
                  Cancel
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save knowledge'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EntryGrid({
  entries,
  onView,
  onEdit,
  onDelete,
  onFavorite,
  onTagClick,
}: {
  entries: Entry[];
  onView: (entry: Entry) => void;
  onEdit: (entry: Entry) => void;
  onDelete: (id: number) => void;
  onFavorite: (id: number) => void;
  onTagClick: (tag: string) => void;
}) {
  return (
    <div className="entry-grid">
      {entries.length ? (
        entries.map(entry => (
          <article className="entry-card" key={entry.id} onClick={() => onView(entry)}>
            <div className="card-actions" onClick={e => e.stopPropagation()}>
              <button title="Favorite" onClick={() => onFavorite(entry.id)}>
                {entry.favorite ? '★' : '☆'}
              </button>
              <button title="Edit" onClick={() => onEdit(entry)}>
                ✎
              </button>
              <button title="Delete" onClick={() => onDelete(entry.id)}>
                ×
              </button>
            </div>
            <p className="eyebrow">
              {entry.category}
              {entry.subcategory ? ` · ${entry.subcategory}` : ''}
            </p>
            <h3>{entry.title}</h3>
            <p className="summary">{entry.summary || entry.notes || 'No summary yet.'}</p>
            {entry.sections.slice(0, 2).map((section, index) => (
              <div className="card-section" key={index}>
                <b>{section.heading}</b>
                <span>{section.content}</span>
              </div>
            ))}
            <div className="chips" onClick={e => e.stopPropagation()}>
              {entry.tags.map(tag => (
                <i
                  key={tag}
                  style={{ cursor: 'pointer' }}
                  title={`Filter by #${tag}`}
                  onClick={() => onTagClick(tag)}
                >
                  #{tag}
                </i>
              ))}
            </div>
            <div className="resource-count">
              {entry.resources.length
                ? `↗ ${entry.resources.length} resource${entry.resources.length > 1 ? 's' : ''}`
                : `${entry.source} capture`}
            </div>
          </article>
        ))
      ) : (
        <div className="empty">
          <h3>No entries found</h3>
          <p>Try a different search or capture something useful.</p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);