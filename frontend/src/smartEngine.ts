import { Entry } from './api';

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

export function smartOrganize(input: {
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

  // Extract inline #hashtags from summary or notes
  const inlineHashtags = `${input.summary} ${input.notes}`.match(/#[a-zA-Z0-9_-]{2,25}/g) || [];
  inlineHashtags.forEach(h => detectedTags.add(h.slice(1).toLowerCase()));

  // Match category & keywords
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

  // Add source tag if useful
  if (input.source && input.source !== 'Manual') {
    detectedTags.add(input.source.toLowerCase());
  }

  // Fallback summary from first sentence of notes if summary is empty
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

export function smartSearch(entries: Entry[], query: string): { entry: Entry; score: number; matchedOn: string[] }[] {
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