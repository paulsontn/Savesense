from datetime import datetime
from pydantic import BaseModel, HttpUrl

class SectionInput(BaseModel): heading: str; content: str
class ResourceInput(BaseModel): name: str; url: str; kind: str = "Website"; description: str | None = None
class EntryInput(BaseModel):
    title: str
    category: str
    subcategory: str | None = None
    source: str = "Manual"
    source_url: str | None = None
    summary: str | None = None
    notes: str | None = None
    favorite: bool = False
    tags: list[str] = []
    sections: list[SectionInput] = []
    resources: list[ResourceInput] = []
class CategoryOut(BaseModel): id: int; name: str
class EntryOut(EntryInput): id: int; created_at: datetime
