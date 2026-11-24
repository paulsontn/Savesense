import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Entry,
  Resource,
  Section,
  createEntry,
  deleteEntryApi,
  fetchEntries,
  fetchUrlMeta,
  toggleFavoriteApi,
  updateEntry,
} from './api';
import { smartOrganize, smartSearch } from './smartEngine';
import './styles.css';
import './extras.css';

type Draft = Omit<Entry, 'id' | 'createdAt' | 'favorite' | 'tags'> & { tags: string };

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

  // Global keyboard shortcuts: Esc closes modals, Ctrl+K or '/' focuses search
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

  // Load entries & check for Bookmarklet URL parameters (?captureUrl=...&captureTitle=...)
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
        if (active) setApiError('Cannot reach SaveSense API at http://localhost:8000. Start the FastAPI backend first.');
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

  // Related entries for the currently viewed entry (matched by shared tags or category)
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

  // Detect duplicate source URL while typing/pasting
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
      message('Could not fetch link metadata. Check that the URL starts with https://');
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
    const slug = entry.title
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
            ? item.sections.filter((s: any) => s?.heading && s?.content)
            : [],
          resources: Array.isArray(item.resources)
            ? item.resources.filter((r: any) => r?.name && r?.url)
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

  const analyzeDraftWithOllama = async () => {
    if (!draft.title && !draft.summary && !draft.notes) {
      message('Add a title, summary, or notes before analyzing.');
      return;
    }
    setAnalyzing(true);
    try {
      const prompt = `Return ONLY valid JSON. You are organizing this personal saved content. Infer useful details; never return blank values when the content supports an answer. Choose exactly one category from: Technology, Finance, Fitness, Healthcare, Skincare, Haircare, Fashion, Food, Entertainment, Education, Government Exams, Personal Development, Science, DIY, Other. Provide 3 to 5 useful tags. Add one or more concise dynamic sections when relevant. Do not invent links: resources must be [] unless a URL was supplied. JSON keys: title, category, subcategory, summary, tags (string array), sections (array of {heading,content}), resources (array of {name,url,kind}). Content: ${JSON.stringify({
        title: draft.title,
        source: draft.source,
        summary: draft.summary,
        notes: draft.notes,
        tags: draft.tags,
      })}`;
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt,
          format: 'json',
          stream: false,
          options: { temperature: 0.2 },
        }),
      });
      if (!response.ok) throw new Error();
      const result = JSON.parse((await response.json()).response);
      setDraft(old => ({
        ...old,
        title: result.title || old.title,
        category: result.category || old.category,
        subcategory: result.subcategory || old.subcategory,
        summary: result.summary || old.summary,
        tags: Array.isArray(result.tags) && result.tags.length ? result.tags.join(', ') : old.tags,
        sections: Array.isArray(result.sections) && result.sections.length ? result.sections : old.sections,
        resources: Array.isArray(result.resources)
          ? result.resources.filter((r: Resource) => r.name && r.url)
          : old.resources,
      }));
      message('Local AI draft ready—review it before saving.');
    } catch {
      runSmartRuleOrganize();
      message('Ollama not running—used instant Smart Rules instead!');
    } finally {
      setAnalyzing(false);
    }
  };

  const askLocalAi = async (e: FormEvent) => {
    e.preventDefault();
    if (!ask.trim()) return;
    if (!entries.length) {
      message('Save some entries first before asking questions.');
      return;
    }
    setAskingAi(true);
    setAiAnswer('');
    try {
      const compactEntries = entries.slice(0, 30).map(item => ({
        title: item.title,
        category: item.category,
        summary: item.summary,
        notes: item.notes,
        tags: item.tags,
        sections: item.sections,
        resources: item.resources.map(r => `${r.name}: ${r.url}`),
      }));
      const prompt = `You are SaveSense, the user's personal knowledge assistant. Answer the user's question concisely using ONLY the saved knowledge entries below. Mention which saved entry titles contain the answer. If nothing matches, say so clearly.

Question: ${ask}

Saved Knowledge:
${JSON.stringify(compactEntries)}`;

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAiAnswer(data.response || 'No response from AI.');
    } catch {
      message('Ollama is off—showing Smart Ranked matches below.');
    } finally {
      setAskingAi(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      ...draft,
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
    } catch (err: any) {
      message(err.message || 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this entry permanently?')) return;
    try {
      await deleteEntryApi(id);
      setEntries(prev => prev.filter(e => e.id !== id));
      if (viewingEntry?.id === id) setViewingEntry(null);
      message('Entry deleted.');
    } catch {
      message('Failed to delete entry.');
    }
  };

  const favorite = async (id: number) => {
    try {
      const updated = await toggleFavoriteApi(id);
      setEntries(prev => prev.map(e => (e.id === id ? updated : e)));
      if (viewingEntry?.id === id) setViewingEntry(updated);
    } catch {
      message('Failed to update favorite.');
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
          <div style={{ marginTop: 18, padding: '12px 16px', borderRadius: 10, background: '#fdecec', color: '#9c2b23', fontWeight: 600 }}>
            ⚠ {apiError}
          </div>
        )}

        {toast && <div className="toast">✓ {toast}</div>}

        {page === 'ask' && (
          <section className="ask-panel">
            <h2>What have you saved?</h2>
            <p>Instant synonym-aware search works automatically as you type—plus optional Ollama AI synthesis.</p>
            <form onSubmit={askLocalAi} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
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
                <h4>✦ AI Summary from Your Notes</h4>
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
              <span>Captured from <strong>{viewingEntry.source}</strong></span>
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
                  onClick={analyzeDraftWithOllama}
                  disabled={analyzing}
                  title="Optional: requires Ollama running locally"
                >
                  {analyzing ? 'AI…' : 'AI Draft'}
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
                  <span>⚠ Already saved under <strong>"{duplicateEntry.title}"</strong></span>
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
                onClick={() => setDraft(old => ({ ...old, sections: [...old.sections, { heading: '', content: '' }] }))}
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
                    onClick={() => setDraft(old => ({ ...old, sections: old.sections.filter((_, i) => i !== index) }))}
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
                  onClick={() => setDraft(old => ({ ...old, resources: old.resources.filter((_, i) => i !== index) }))}
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