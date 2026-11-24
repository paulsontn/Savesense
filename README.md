# SaveSense

Capture useful discoveries from Instagram, YouTube, articles, and websites, organize them into flexible knowledge entries, and retrieve them effortlessly—with or without AI.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite (`frontend/`)
- **Backend:** FastAPI, SQLAlchemy, SQLite (`backend/`)
- **Smart Organization:** Built-in deterministic rule engine (`smartEngine.ts`) + optional local AI via **Ollama** (`llama3.2:3b`)

## Project Structure

    savesense/
    ├── backend/
    │   ├── app/
    │   │   ├── database.py      # SQLite connection & session management
    │   │   ├── main.py          # FastAPI REST endpoints & URL metadata fetcher
    │   │   ├── models.py        # SQLAlchemy ORM models
    │   │   └── schemas.py       # Pydantic request/response schemas
    │   └── requirements.txt
    ├── frontend/
    │   ├── src/
    │   │   ├── api.ts           # Typed REST API client
    │   │   ├── smartEngine.ts   # Rule-based auto-tagger & weighted synonym search
    │   │   ├── main.tsx         # Core UI, modals, bookmarklet & backup logic
    │   │   ├── styles.css       # Layout & theme styles
    │   │   └── extras.css       # Detail view, mobile nav & card styles
    │   ├── .env.example
    │   ├── index.html
    │   └── package.json
    └── README.md

## Features

- **Fast Capture & URL Auto-Fill:** Paste any link and click **Fetch Info** to automatically extract the page title, description, and source (`YouTube`, `Instagram`, `Article`, `Website`), with instant duplicate URL warnings.
- **1-Click Browser Bookmarklet:** Clip any active webpage or YouTube video directly into SaveSense with pre-filled metadata.
- **Instant Smart Auto-Tagging (No AI Required):** Automatically categorizes entries, extracts `#hashtags` from notes, and assigns tags using a built-in rule engine.
- **Weighted Synonym Search & Q&A:** Find notes using everyday synonyms (e.g., searching *pimples* surfaces *acne* entries) ranked across titles, tags, summaries, and notes (`Ctrl + K` or `/` shortcut).
- **Structured Knowledge Cards:** Attach custom dynamic sections, typed resource links (`YouTube`, `GitHub`, `Article`, `Product`), images, and favorites.
- **Read-Only Detail View & Related Entries:** Inspect full notes, open saved resources, discover automatically linked related entries, and copy or download individual notes as Markdown (`.md`).
- **Full Data Portability:** Export and import your entire knowledge base as JSON backups anytime.

## Run Locally

Open **two separate terminals** from the project root (`savesense/`):

### 1. Start the Backend (FastAPI + SQLite)

**Windows (PowerShell):**

    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

**macOS / Linux:**

    cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

The API runs at `http://localhost:8000` (interactive docs at `http://localhost:8000/docs`).

### 2. Start the Frontend (React + Vite)

In a **second terminal**:

    cd frontend
    cp .env.example .env
    npm install
    npm run dev

Open `http://localhost:5173` in your browser.

### 3. Optional Local AI (Ollama)

SaveSense works 100% out of the box without AI. If you also want local LLM drafting and Q&A summarization without sending notes to the cloud, install [Ollama](https://ollama.com) and run:

    ollama pull llama3.2:3b