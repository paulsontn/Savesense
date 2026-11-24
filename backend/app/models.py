from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    subcategories: Mapped[list["Subcategory"]] = relationship(back_populates="category", cascade="all, delete-orphan")
    entries: Mapped[list["KnowledgeEntry"]] = relationship(back_populates="category")

class Subcategory(Base):
    __tablename__ = "subcategories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    category: Mapped[Category] = relationship(back_populates="subcategories")

class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    source: Mapped[str] = mapped_column(String(50), default="Manual")
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    subcategory_id: Mapped[int | None] = mapped_column(ForeignKey("subcategories.id"), nullable=True)
    category: Mapped[Category] = relationship(back_populates="entries")
    subcategory: Mapped[Subcategory | None] = relationship()
    sections: Mapped[list["EntrySection"]] = relationship(back_populates="entry", cascade="all, delete-orphan")
    resources: Mapped[list["Resource"]] = relationship(back_populates="entry", cascade="all, delete-orphan")
    tags: Mapped[list["Tag"]] = relationship(back_populates="entry", cascade="all, delete-orphan")

class EntrySection(Base):
    __tablename__ = "entry_sections"
    id: Mapped[int] = mapped_column(primary_key=True)
    heading: Mapped[str] = mapped_column(String(120))
    content: Mapped[str] = mapped_column(Text)
    entry_id: Mapped[int] = mapped_column(ForeignKey("knowledge_entries.id"))
    entry: Mapped[KnowledgeEntry] = relationship(back_populates="sections")

class Resource(Base):
    __tablename__ = "resources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    url: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(40), default="Website")
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("knowledge_entries.id"))
    entry: Mapped[KnowledgeEntry] = relationship(back_populates="resources")

class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), index=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("knowledge_entries.id"))
    entry: Mapped[KnowledgeEntry] = relationship(back_populates="tags")