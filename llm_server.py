#!/usr/bin/env python3
"""
Cherry Local LLM Server — Streaming edition
Conversational replies only (short). Tool selection happens separately via intent engine.
"""

import os, json, time, threading
from pathlib import Path

try:
    from flask import Flask, request, jsonify, Response, stream_with_context
    from llama_cpp import Llama
except ImportError as e:
    print(f"[cherry-llm] Missing dep: {e}\nRun: pip3 install llama-cpp-python flask")
    exit(1)

try:
    from flask_cors import CORS
    _has_cors = True
except ImportError:
    _has_cors = False

# ── Model resolution ─────────────────────────────────────────────────────────
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
    print("[cherry-llm] No model found.")
    exit(1)

print(f"[cherry-llm] Loading: {model_path}")
try:
    import psutil
    ram_gb = psutil.virtual_memory().total / (1024 ** 3)
    ctx = 512 if ram_gb < 4.5 else 1024 if ram_gb < 8.5 else 2048
except:
    ctx = 1024

llm = Llama(model_path=model_path, n_ctx=ctx, verbose=False)
print(f"[cherry-llm] Ready — ctx={ctx} — listening on :11434")

# ── System prompt — INTENTIONALLY SHORT ──────────────────────────────────────
# Small models fall apart with long prompts. Keep it < 60 tokens.
# Tool suggestions are handled by the intent engine, not the LLM.
SYSTEM_PROMPT = (
    "You are Cherry, a social media automation assistant. "
    "Reply in 1-2 short sentences only. "
    "Confirm what you'll do or ask ONE clarifying question. "
    "Never list steps or number things."
)

def build_messages(history, message):
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history[-4:]:
        msgs.append({"role": msg["role"], "content": msg["content"]})
    msgs.append({"role": "user", "content": message})
    return msgs

# ── Flask ────────────────────────────────────────────────────────────────────
app = Flask(__name__)
if _has_cors:
    CORS(app)

lock = threading.Lock()

@app.route("/health")
def health():
    return jsonify({"ok": True, "model": os.path.basename(model_path), "ctx": ctx})

@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    """SSE streaming endpoint — yields tokens one by one."""
    data = request.json or {}
    message = data.get("message", "").strip()
    history = data.get("history", [])

    if not message:
        return jsonify({"error": "message required"}), 400

    messages = build_messages(history, message)

    def generate():
        with lock:
            try:
                stream = llm.create_chat_completion(
                    messages=messages,
                    max_tokens=90,
                    temperature=0.65,
                    top_p=0.9,
                    repeat_penalty=1.1,
                    stop=["1.", "Step ", "\n\n"],
                    stream=True,
                )
                for chunk in stream:
                    delta = chunk["choices"][0].get("delta", {})
                    token = delta.get("content", "")
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'token': f'Error: {str(e)}'})}\n\n"

        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=11434, debug=False, threaded=True)
