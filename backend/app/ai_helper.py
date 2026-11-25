"""
Cloud AI Helper for SaveSense (Zero Extra Dependencies)
Supports:
1. Google Gemini API (Free Tier via GEMINI_API_KEY)
2. Groq API (Free Tier via GROQ_API_KEY)
3. Local Ollama fallback (OLLAMA_URL)
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List


def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int = 20) -> Dict[str, Any]:
    """Send an HTTP POST request with a JSON body and parse the JSON response."""
    data = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json", **headers}
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_json_block(raw_text: str) -> Dict[str, Any]:
    """Safely parse JSON from an LLM response even if wrapped in markdown fences."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # Strip opening ```json or ``` and closing ```
        if len(lines) >= 3:
            cleaned = "\n".join(lines[1:-1]).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def call_free_ai(prompt: str, expect_json: bool = False) -> str:
    """
    Query the configured free cloud AI provider:
    - GEMINI_API_KEY -> Google Gemini 2.5 Flash (free tier)
    - GROQ_API_KEY   -> Groq Llama 3.3 70B (free tier)
    - Local Ollama   -> http://localhost:11434
    Raises RuntimeError if no provider responds.
    """
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434").strip()

    # 1. Google Gemini Free Tier (Google AI Studio)
    if gemini_key:
        custom_model = os.getenv("GEMINI_MODEL", "").strip()
        candidate_models = [custom_model] if custom_model else [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash",
        ]
        gen_config: Dict[str, Any] = {"temperature": 0.4}
        if expect_json:
            gen_config["responseMimeType"] = "application/json"

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": gen_config,
        }
        last_err: Exception | None = None
        for model in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
            try:
                res = _post_json(url, payload, headers={})
                return res["candidates"][0]["content"]["parts"][0]["text"].strip()
            except urllib.error.HTTPError as exc:
                err_body = exc.read().decode("utf-8", errors="ignore")
                last_err = RuntimeError(f"Gemini ({model}) HTTP {exc.code}: {err_body}")
                if exc.code == 404:
                    continue
                raise last_err from exc
            except Exception as exc:
                last_err = exc
                continue
        raise RuntimeError(f"Gemini API error: {last_err}")

    # 2. Groq Free Tier
    if groq_key:
        model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        url = "https://api.groq.com/openai/v1/chat/completions"
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.4,
        }
        try:
            res = _post_json(url, payload, headers={"Authorization": f"Bearer {groq_key}"})
            return res["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            raise RuntimeError(f"Groq API error: {exc}") from exc

    # 3. Local Ollama Fallback (when running on localhost)
    try:
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2")
        payload = {"model": ollama_model, "prompt": prompt, "stream": False}
        res = _post_json(f"{ollama_url}/api/generate", payload, headers={}, timeout=6)
        return res.get("response", "").strip()
    except Exception as exc:
        raise RuntimeError(f"No cloud AI key configured and Ollama unavailable: {exc}") from exc


def generate_entry_draft(title: str, url: str, notes: str, existing_categories: List[str]) -> Dict[str, Any]:
    """
    Generate structured category, summary, tags, and key sections for a SaveSense entry.
    """
    cats_text = ", ".join(existing_categories) if existing_categories else "Technology, Learning, Design, Productivity, Inspiration"
    prompt = f"""You are an assistant for SaveSense, a personal knowledge hub.
Analyze the saved item below and return ONLY valid JSON with these exact keys:
- "category": string (pick the best match from [{cats_text}] or suggest a concise 1-2 word category)
- "summary": string (a clear, insightful 1-2 sentence summary)
- "tags": array of 3 to 5 lowercase single-word or hyphenated tags
- "sections": array of 1 to 2 objects with {{"heading": string, "content": string}} highlighting key takeaways

Item details:
Title: {title}
URL: {url}
Raw Notes: {notes}
"""
    raw = call_free_ai(prompt, expect_json=True)
    parsed = _extract_json_block(raw)
    return {
        "category": str(parsed.get("category", "General")).strip() or "General",
        "summary": str(parsed.get("summary", "")).strip(),
        "tags": [str(t).strip().lower() for t in parsed.get("tags", []) if str(t).strip()][:6],
        "sections": [
            {"heading": str(s.get("heading", "Key Takeaway")), "content": str(s.get("content", ""))}
            for s in parsed.get("sections", [])
            if isinstance(s, dict) and s.get("content")
        ],
    }


def answer_knowledge_query(question: str, entries: List[Dict[str, Any]]) -> str:
    """
    Answer a user's question grounded in their saved SaveSense knowledge entries.
    """
    context_blocks = []
    for item in entries[:15]:
        context_blocks.append(
            f"- Title: {item.get('title', '')}\n"
            f"  Category: {item.get('category', '')}\n"
            f"  Summary: {item.get('summary', '')}\n"
            f"  Notes: {item.get('notes', '')}\n"
            f"  URL: {item.get('url', '')}"
        )
    joined_context = "\n".join(context_blocks) if context_blocks else "No saved entries yet."

    prompt = f"""You are SaveSense AI. Answer the user's question concisely using ONLY their saved knowledge items below.
Cite the relevant entry titles in your answer. If nothing matches, say so briefly.

Saved Knowledge:
{joined_context}

User Question: {question}
"""
    return call_free_ai(prompt, expect_json=False)