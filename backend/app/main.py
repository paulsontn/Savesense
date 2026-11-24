from html import unescape
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload
from .database import Base, engine, get_db
from .models import Category, EntrySection, KnowledgeEntry, Resource, Subcategory, Tag
from .schemas import CategoryOut, EntryInput, EntryOut

Base.metadata.create_all(bind=engine)
app = FastAPI(title="SaveSense API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class MetaRequest(BaseModel):
    url: str

def entry_out(e: KnowledgeEntry):
    return {
        "id": e.id,
        "title": e.title,
        "category": e.category.name,
        "subcategory": e.subcategory.name if e.subcategory else None,
        "source": e.source,
        "source_url": e.source_url,
        "summary": e.summary,
        "notes": e.notes,
        "image": e.image,
        "favorite": e.favorite,
        "tags": [x.name for x in e.tags],
        "sections": [{"heading": x.heading, "content": x.content} for x in e.sections],
        "resources": [
            {"name": x.name, "url": x.url, "kind": x.kind, "description": x.description}
            for x in e.resources
        ],
        "created_at": e.created_at,
    }

def get_or_create_category(db: Session, name: str):
    clean = name.strip()
    category = db.scalar(select(Category).where(Category.name == clean))
    if not category:
        category = Category(name=clean)
        db.add(category)
        db.flush()
    return category

def get_or_create_subcategory(db: Session, category: Category, name: str | None):
    if not name or not name.strip():
        return None
    clean = name.strip()
    sub = db.scalar(
        select(Subcategory).where(Subcategory.name == clean, Subcategory.category_id == category.id)
    )
    if not sub:
        sub = Subcategory(name=clean, category=category)
        db.add(sub)
        db.flush()
    return sub

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/fetch-meta")
def fetch_url_metadata(payload: MetaRequest):
    url = payload.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")

    host = urlparse(url).netloc.lower()
    source = "Website"
    if "youtube.com" in host or "youtu.be" in host:
        source = "YouTube"
    elif "instagram.com" in host:
        source = "Instagram"
    elif "medium.com" in host or "substack.com" in host:
        source = "Article"

    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 (SaveSense Metadata Bot)"})
        with urlopen(req, timeout=6) as resp:
            html = resp.read(250_000).decode("utf-8", errors="ignore")

        og_title = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', html, re.I | re.S)
        tag_title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        og_desc = re.search(r'<meta[^>]+(?:name|property)=["\'](?:og:description|description)["\'][^>]+content=["\'](.*?)["\']', html, re.I | re.S)

        raw_title = (og_title.group(1) if og_title else (tag_title.group(1) if tag_title else "")).strip()
        raw_desc = (og_desc.group(1) if og_desc else "").strip()

        clean_title = re.sub(r"\s+", " ", unescape(raw_title))
        clean_desc = re.sub(r"\s+", " ", unescape(raw_desc))

        return {"title": clean_title[:200], "summary": clean_desc[:600], "source": source}
    except Exception:
        return {"title": "", "summary": "", "source": source}

@app.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)):
    return db.scalars(select(Category).order_by(Category.name)).all()

@app.get("/entries", response_model=list[EntryOut])
def list_entries(q: str = "", category: str = "", db: Session = Depends(get_db)):
    stmt = (
        select(KnowledgeEntry)
        .options(
            selectinload(KnowledgeEntry.category).selectinload(Category.subcategories),
            selectinload(KnowledgeEntry.tags),
            selectinload(KnowledgeEntry.sections),
            selectinload(KnowledgeEntry.resources),
        )
        .order_by(KnowledgeEntry.created_at.desc())
    )
    if q:
        stmt = stmt.where(
            or_(
                KnowledgeEntry.title.ilike(f"%{q}%"),
                KnowledgeEntry.notes.ilike(f"%{q}%"),
                KnowledgeEntry.summary.ilike(f"%{q}%"),
            )
        )
    if category:
        stmt = stmt.join(KnowledgeEntry.category).where(Category.name == category)
    return [entry_out(e) for e in db.scalars(stmt).unique().all()]

@app.post("/entries", response_model=EntryOut, status_code=201)
def create_entry(data: EntryInput, db: Session = Depends(get_db)):
    c = get_or_create_category(db, data.category)
    subcategory = get_or_create_subcategory(db, c, data.subcategory)
    e = KnowledgeEntry(
        title=data.title.strip(),
        category=c,
        subcategory=subcategory,
        source=data.source,
        source_url=data.source_url,
        summary=data.summary,
        notes=data.notes,
        image=data.image,
        favorite=data.favorite,
    )
    e.sections = [EntrySection(**s.model_dump()) for s in data.sections]
    e.resources = [Resource(**r.model_dump()) for r in data.resources]
    e.tags = [Tag(name=t.strip()) for t in data.tags if t.strip()]
    db.add(e)
    db.commit()
    db.refresh(e)
    return entry_out(e)

@app.put("/entries/{entry_id}", response_model=EntryOut)
def update_entry(entry_id: int, data: EntryInput, db: Session = Depends(get_db)):
    e = db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    c = get_or_create_category(db, data.category)
    e.title = data.title.strip()
    e.category = c
    e.subcategory = get_or_create_subcategory(db, c, data.subcategory)
    e.source = data.source
    e.source_url = data.source_url
    e.summary = data.summary
    e.notes = data.notes
    e.image = data.image
    e.sections = [EntrySection(**s.model_dump()) for s in data.sections]
    e.resources = [Resource(**r.model_dump()) for r in data.resources]
    e.tags = [Tag(name=t.strip()) for t in data.tags if t.strip()]
    db.commit()
    db.refresh(e)
    return entry_out(e)

@app.patch("/entries/{entry_id}/favorite", response_model=EntryOut)
def toggle_favorite(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    e.favorite = not e.favorite
    db.commit()
    db.refresh(e)
    return entry_out(e)

@app.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    db.delete(e)
    db.commit()