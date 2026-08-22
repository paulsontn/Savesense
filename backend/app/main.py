from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload
from .database import Base, engine, get_db
from .models import Category, EntrySection, KnowledgeEntry, Resource, Subcategory, Tag
from .schemas import CategoryOut, EntryInput, EntryOut

Base.metadata.create_all(bind=engine)
app = FastAPI(title="SaveSense API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

def entry_out(e: KnowledgeEntry):
    return {"id":e.id,"title":e.title,"category":e.category.name,"subcategory":e.subcategory.name if e.subcategory else None,"source":e.source,"source_url":e.source_url,"summary":e.summary,"notes":e.notes,"favorite":e.favorite,"tags":[x.name for x in e.tags],"sections":[{"heading":x.heading,"content":x.content} for x in e.sections],"resources":[{"name":x.name,"url":x.url,"kind":x.kind,"description":x.description} for x in e.resources],"created_at":e.created_at}

def get_or_create_category(db: Session, name: str):
    category = db.scalar(select(Category).where(Category.name == name.strip()))
    if not category:
        category = Category(name=name.strip()); db.add(category); db.flush()
    return category

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)): return db.scalars(select(Category).order_by(Category.name)).all()

@app.get("/entries", response_model=list[EntryOut])
def list_entries(q: str = "", category: str = "", db: Session = Depends(get_db)):
    stmt = select(KnowledgeEntry).options(selectinload(KnowledgeEntry.category).selectinload(Category.subcategories), selectinload(KnowledgeEntry.tags), selectinload(KnowledgeEntry.sections), selectinload(KnowledgeEntry.resources)).order_by(KnowledgeEntry.created_at.desc())
    if q: stmt = stmt.where(or_(KnowledgeEntry.title.ilike(f"%{q}%"), KnowledgeEntry.notes.ilike(f"%{q}%"), KnowledgeEntry.summary.ilike(f"%{q}%")))
    if category: stmt = stmt.join(KnowledgeEntry.category).where(Category.name == category)
    return [entry_out(e) for e in db.scalars(stmt).unique().all()]

@app.post("/entries", response_model=EntryOut, status_code=201)
def create_entry(data: EntryInput, db: Session = Depends(get_db)):
    c = get_or_create_category(db, data.category)
    subcategory = None
    if data.subcategory:
        subcategory = db.scalar(select(Subcategory).where(Subcategory.name == data.subcategory, Subcategory.category_id == c.id))
        if not subcategory:
            subcategory = Subcategory(name=data.subcategory, category=c); db.add(subcategory); db.flush()
    e = KnowledgeEntry(title=data.title, category=c, subcategory=subcategory, source=data.source, source_url=data.source_url, summary=data.summary, notes=data.notes, favorite=data.favorite)
    e.sections=[EntrySection(**s.model_dump()) for s in data.sections]; e.resources=[Resource(**r.model_dump()) for r in data.resources]; e.tags=[Tag(name=t) for t in data.tags]
    db.add(e); db.commit(); db.refresh(e)
    return entry_out(e)

@app.patch("/entries/{entry_id}/favorite", response_model=EntryOut)
def toggle_favorite(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(KnowledgeEntry, entry_id)
    if not e: raise HTTPException(404, "Entry not found")
    e.favorite = not e.favorite; db.commit(); db.refresh(e); return entry_out(e)

@app.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(KnowledgeEntry, entry_id)
    if not e: raise HTTPException(404, "Entry not found")
    db.delete(e); db.commit()
