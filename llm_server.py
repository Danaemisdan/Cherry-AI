#!/usr/bin/env python3
"""
Cherry Local LLM Server — Unified AI Brain
Wraps the local GGUF model as an HTTP API at http://localhost:11434
"""

import os, json, time, threading, re
from pathlib import Path

try:
    from flask import Flask, request, jsonify
    from llama_cpp import Llama
except ImportError as e:
    print(f"[cherry-llm] Missing dep: {e}\nRun: pip3 install llama-cpp-python flask")
    exit(1)

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
    ram_gb = psutil.virtual_memory().total / (1024**3)
    ctx = 512 if ram_gb < 4.5 else 1024 if ram_gb < 8.5 else 2048 if ram_gb < 16.5 else 4096
except:
    ctx = 2048

llm = Llama(model_path=model_path, n_ctx=ctx, verbose=False)
print(f"[cherry-llm] Ready — ctx={ctx} — listening on :11434")

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are Cherry, an AI growth agent. You help users automate social media, outreach, lead generation, and content creation using a real browser.

PLATFORMS: instagram, twitter, linkedin, facebook, gmail, whatsapp, chatgpt, gemini

TOOLS you can call:
OUTREACH:
- send_dm(platform, target, goal, tone, imagePath?) → send DM or email, optionally with image
- bulk_dm(platform, goal, tone, imagePath?) → DM many people from a CSV
- send_image_dm(platform, target, imagePath, goal) → DM specifically with an image attachment

LEADS & SCRAPING:
- find_leads(platform, query, maxResults) → find and export profiles
- scrape_followers(platform, target, maxResults) → extract competitor audience
- deep_scrape(platform, query, maxResults) → scrape + open each profile for full context

ENGAGEMENT:
- like_post(platform, target) → like a user's post
- comment_post(platform, target, tone) → AI comment on a post
- follow_user(platform, target) → follow someone
- follow_and_dm(platform, target, goal, tone) → follow then DM

CONTENT:
- auto_post(platform, goal, tone, imagePath?) → create and publish a post
- generate_image(aiPlatform, subject, style) → generate image with ChatGPT or Gemini
- upload_image_to_ai(aiPlatform, imagePath, instruction) → send image to AI for editing/analysis
- generate_and_post(aiPlatform, socialPlatform, subject, goal) → generate image → post it
- generate_and_dm(aiPlatform, socialPlatform, target, subject, goal) → generate image → DM it

IMAGE OPS:
- download_image(platform, target) → download image/media from a post or profile
- attach_image(imagePath) → attach a local image to the next action

INBOX & CONTEXT:
- get_inbox(platform) → read and summarize inbox/emails
- search_inbox(platform, query) → search messages or emails
- get_profile_context(platform, target) → get full context on a person

CONTINUOUS (background):
- run_continuous(tools, objective, cadenceMinutes) → schedule tools to run on repeat in background

RESPONSE RULES:
1. Reply conversationally in plain text first.
2. Then, if the user wants action, add a CHERRY_ACTIONS block with 1-3 options.
3. Each option has: label, tools array, mode (burst/continuous), optional cadenceMinutes.
4. Tools array can have MULTIPLE tools — they run in sequence.
5. If just chatting or clarifying, skip CHERRY_ACTIONS.

FORMAT:
[your conversational reply]

CHERRY_ACTIONS:
```json
[
  {
    "label": "Human-readable description of what this does",
    "tools": [
      {"tool": "tool_name", "params": {"key": "value"}},
      {"tool": "another_tool", "params": {"key": "value"}}
    ],
    "mode": "burst",
    "cadenceMinutes": null
  },
  {
    "label": "Run this automatically every day",
    "tools": [...same tools...],
    "mode": "continuous",
    "cadenceMinutes": 1440
  }
]
```

EXAMPLES:

User: "DM fintech founders on LinkedIn about my SaaS tool"
Reply: I'll find fintech founders on LinkedIn and send them a personalized DM about your SaaS.

CHERRY_ACTIONS:
```json
[
  {
    "label": "Find 20 fintech founders on LinkedIn + DM them",
    "tools": [
      {"tool": "find_leads", "params": {"platform": "linkedin", "query": "fintech founders", "maxResults": 20}},
      {"tool": "bulk_dm", "params": {"platform": "linkedin", "goal": "Introduce my SaaS tool", "tone": "Professional and brief"}}
    ],
    "mode": "burst"
  },
  {
    "label": "Do this automatically every day",
    "tools": [
      {"tool": "find_leads", "params": {"platform": "linkedin", "query": "fintech founders", "maxResults": 20}},
      {"tool": "bulk_dm", "params": {"platform": "linkedin", "goal": "Introduce my SaaS tool", "tone": "Professional and brief"}}
    ],
    "mode": "continuous",
    "cadenceMinutes": 1440
  }
]
```

User: "Generate an image of my product and post it on Instagram"
Reply: I'll generate a product image with ChatGPT and post it to Instagram.

CHERRY_ACTIONS:
```json
[
  {
    "label": "Generate product image → Post to Instagram",
    "tools": [
      {"tool": "generate_image", "params": {"aiPlatform": "chatgpt", "subject": "product showcase", "style": "clean and professional"}},
      {"tool": "auto_post", "params": {"platform": "instagram", "goal": "Showcase my product", "tone": "Excited and professional"}}
    ],
    "mode": "burst"
  }
]
```

User: "what can you do?"
Reply: I can automate your entire social media and outreach. Here's what I can do: find leads, send DMs and emails (with images), comment and like posts, follow users, post content, generate AI images and post them, scrape competitor audiences, read your inbox, and run all of these continuously in the background. Just tell me your goal and I'll suggest the best approach.
"""

# ── Build chat prompt ─────────────────────────────────────────────────────────
def build_prompt(history, user_message):
    lines = [f"<|system|>\n{SYSTEM_PROMPT}\n</s>"]
    for msg in history[-6:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        tag = "<|user|>" if role == "user" else "<|assistant|>"
        lines.append(f"{tag}\n{content}\n</s>")
    lines.append(f"<|user|>\n{user_message}\n</s>\n<|assistant|>")
    return "\n".join(lines)

def parse_actions(text):
    """Extract CHERRY_ACTIONS JSON block from model response."""
    match = re.search(r'CHERRY_ACTIONS:\s*```json\s*(.*?)```', text, re.DOTALL)
    if not match:
        # Try without code fence
        match = re.search(r'CHERRY_ACTIONS:\s*(\[.*?\])', text, re.DOTALL)
    if not match:
        return None, text

    raw_json = match.group(1).strip()
    try:
        actions = json.loads(raw_json)
        # Remove the CHERRY_ACTIONS block from the reply text
        clean_reply = text[:match.start()].strip()
        return actions, clean_reply
    except json.JSONDecodeError:
        return None, text

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
lock = threading.Lock()

@app.route("/health")
def health():
    return jsonify({"ok": True, "model": os.path.basename(model_path), "ctx": ctx})

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json or {}
    user_message = data.get("message", "").strip()
    history = data.get("history", [])
    max_tokens = int(data.get("max_tokens", 600))
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

    raw_text = output["choices"][0]["text"].strip()
    actions, reply = parse_actions(raw_text)

    return jsonify({
        "reply": reply,
        "actions": actions,
        "elapsed": elapsed,
        "tokens": output["usage"]["completion_tokens"],
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=11434, debug=False)
