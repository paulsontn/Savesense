export type Section = { heading: string; content: string };
export type Resource = { name: string; url: string; kind: string; description?: string | null };

export type Entry = {
  id: number;
  title: string;
  category: string;
  subcategory: string;
  source: string;
  sourceUrl: string;
  summary: string;
  notes: string;
  image?: string;
  favorite: boolean;
  tags: string[];
  sections: Section[];
  resources: Resource[];
  createdAt: string;
};

export type EntryPayload = Omit<Entry, 'id' | 'createdAt' | 'favorite'> & { favorite?: boolean };

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function fromApi(raw: any): Entry {
  return {
    id: raw.id,
    title: raw.title,
    category: raw.category,
    subcategory: raw.subcategory || '',
    source: raw.source || 'Manual',
    sourceUrl: raw.source_url || '',
    summary: raw.summary || '',
    notes: raw.notes || '',
    image: raw.image || '',
    favorite: Boolean(raw.favorite),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    createdAt: raw.created_at,
  };
}

function toApi(data: EntryPayload) {
  return {
    title: data.title,
    category: data.category,
    subcategory: data.subcategory || null,
    source: data.source,
    source_url: data.sourceUrl || null,
    summary: data.summary || null,
    notes: data.notes || null,
    image: data.image || null,
    favorite: data.favorite ?? false,
    tags: data.tags,
    sections: data.sections,
    resources: data.resources.map(r => ({
      name: r.name,
      url: r.url,
      kind: r.kind,
      description: r.description ?? null,
    })),
  };
}

export async function fetchEntries(): Promise<Entry[]> {
  const res = await fetch(`${API_BASE}/entries`);
  if (!res.ok) throw new Error('Failed to load entries from server.');
  const data = await res.json();
  return data.map(fromApi);
}

export async function createEntry(payload: EntryPayload): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toApi(payload)),
  });
  if (!res.ok) throw new Error('Failed to save entry.');
  return fromApi(await res.json());
}

export async function updateEntry(id: number, payload: EntryPayload): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toApi(payload)),
  });
  if (!res.ok) throw new Error('Failed to update entry.');
  return fromApi(await res.json());
}

export async function toggleFavoriteApi(id: number): Promise<Entry> {
  const res = await fetch(`${API_BASE}/entries/${id}/favorite`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to update favorite status.');
  return fromApi(await res.json());
}

export async function deleteEntryApi(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/entries/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete entry.');
}
export async function fetchUrlMeta(url: string): Promise<{ title: string; summary: string; source: string }> {
  const res = await fetch(`${API_BASE}/fetch-meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error('Could not fetch link details.');
  return res.json();
}