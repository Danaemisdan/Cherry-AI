#!/usr/bin/env python3
"""
Cherry Local LLM Server
Wraps cherry-ai-engine.gguf (TinyLlama/Qwen family) as an HTTP API
that the Cherry backend can call at http://localhost:11434

Usage:
  pip3 install llama-cpp-python flask
  python3 llm_server.py
"""

import os, json, time, threading
from pathlib import Path

try:
    from flask import Flask, request, jsonify
    from llama_cpp import Llama
except ImportError as e:
    print(f"[cherry-llm] Missing dep: {e}")
    print("Run: pip3 install llama-cpp-python flask")
    exit(1)

# ── Model resolution ────────────────────────────────────────────────────────
ROOT = Path(__file__).parent

CANDIDATES = [
    ROOT / "release" / "cherry-ai-complete" / "runtime" / "cherry-ai-engine.gguf",
    ROOT / "release" / "cherry-ai-portable" / "runtime" / "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    ROOT / "native-host" / "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    ROOT / "Models" / "TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf",
]

model_path = os.environ.get("CHERRY_MODEL_PATH", "").strip()
if not model_path:
    for c in CANDIDATES:
        if c.exists():
            model_path = str(c)
            break

if not model_path:
    print("[cherry-llm] No model found. Set CHERRY_MODEL_PATH or place gguf in /Models/")
    exit(1)

print(f"[cherry-llm] Loading model: {model_path}")

# Auto-detect context size from RAM
try:
    import psutil
    ram_gb = psutil.virtual_memory().total / (1024**3)
    ctx = 512 if ram_gb < 4.5 else 1024 if ram_gb < 8.5 else 2048 if ram_gb < 16.5 else 4096
except:
    ctx = 1024

llm = Llama(model_path=model_path, n_ctx=ctx, verbose=False)
print(f"[cherry-llm] Ready — ctx={ctx}, listening on :11434")

# ── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
lock = threading.Lock()

SYSTEM_PROMPT = """You are Cherry, an intelligent AI assistant built into the Cherry AI platform.
You help users automate social media, outreach, lead generation, and content creation.

You have access to these Cherry tools that control real browsers:
- send_dm(platform, target, goal, tone) — send a DM or email
- find_leads(platform, query, maxResults) — scrape leads by keyword
- like_post(platform, target) — like a user's post
- ai_comment(platform, target, tone) — comment on a post with AI
- follow_user(platform, target) — follow a user
- auto_post(platform, goal, tone, attachment) — create and publish a post
- bulk_dm(platform, goal, tone) — DM many people from a CSV list
- scrape_followers(platform, target) — extract a competitor's audience
- generate_image(platform, subject, style) — generate an image via ChatGPT/Gemini
- ask_ai(platform, question) — ask ChatGPT or Gemini a question
- gmail_search(query) — search Gmail inbox
- get_inbox_context(platform) — read and summarize inbox
- run_continuous(platforms, objective, cadenceMinutes) — set up a repeating campaign

When the user wants to take action, respond with a JSON tool call in this format:
{"tool": "tool_name", "params": {...}, "mode": "burst|continuous", "confirm": true}

For continuous actions, always set confirm: true and suggest a cadence.
For simple conversation or clarifying questions, just reply as normal text.
Keep responses concise. Be direct and practical."""


def build_prompt(history, user_message):
    """Build a TinyLlama/Qwen-compatible chat prompt."""
    lines = [f"<|system|>\n{SYSTEM_PROMPT}\n</s>"]
    for msg in history[-8:]:  # last 8 turns for context
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"<|user|>\n{content}\n</s>")
        else:
            lines.append(f"<|assistant|>\n{content}\n</s>")
    lines.append(f"<|user|>\n{user_message}\n</s>")
    lines.append("<|assistant|>")
    return "\n".join(lines)


@app.route("/health")
def health():
    return jsonify({"ok": True, "model": os.path.basename(model_path), "ctx": ctx})


@app.route("/chat", methods=["POST"])
def chat():
    data = request.json or {}
    user_message = data.get("message", "").strip()
    history = data.get("history", [])
    max_tokens = int(data.get("max_tokens", 400))
    temperature = float(data.get("temperature", 0.7))

    if not user_message:
        return jsonify({"error": "message required"}), 400

    prompt = build_prompt(history, user_message)

    with lock:
        t0 = time.time()
        output = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["</s>", "<|user|>", "<|system|>"],
            echo=False,
        )
        elapsed = round(time.time() - t0, 2)

    text = output["choices"][0]["text"].strip()

    # Try to parse tool call from response
    tool_call = None
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            parsed = json.loads(text[start:end])
            if "tool" in parsed:
                tool_call = parsed
                # text before/after JSON is the spoken part
                text = (text[:start] + text[end:]).strip()
    except Exception:
        pass

    return jsonify({
        "reply": text,
        "tool_call": tool_call,
        "elapsed": elapsed,
        "tokens": output["usage"]["completion_tokens"],
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=11434, debug=False)
