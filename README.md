# SaveSense

Capture useful discoveries, organize them into flexible knowledge entries, and find them when needed.

## Structure

- `frontend/` — React + TypeScript + Vite user interface
- `backend/` — FastAPI REST API with a SQLite development database

## Run locally

### Backend

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the address Vite shows (normally `http://localhost:5173`). The frontend calls the API at `http://localhost:8000`.

## MVP included

- Dashboard counts and category overview
- Categories and subcategories
- Knowledge entries with custom/dynamic sections
- Tags and typed resources
- Search, category filter, favorite toggle, edit and delete

Authentication, file uploads, AI processing, and semantic search are intentionally planned as the next phases after the core workflow is stable.

## Free local AI (optional)

SaveSense can use **Ollama** to draft a category, summary, tags, and dynamic sections without sending your notes to a cloud provider. Install Ollama for Windows, then run this once in PowerShell:

```powershell
ollama pull llama3.2:3b
```

Open a Quick Capture form, add some notes or a title, then click **Analyze with local AI**. Review the draft before saving. If Ollama is not installed or its model has not been downloaded, the rest of SaveSense continues to work normally.
