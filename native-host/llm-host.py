#!/usr/bin/env python3
import sys
import json
import struct
import os

# To test this locally, run: pip3 install llama-cpp-python huggingface-hub
IMPORT_ERROR = None
try:
    from llama_cpp import Llama
    import psutil
except ImportError as exc:
    IMPORT_ERROR = exc

# Read from Chrome's stdio protocol
def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        sys.exit(0)
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

# Send to Chrome's stdio protocol
def send_message(message_content):
    encoded_content = json.dumps(message_content).encode('utf-8')
    encoded_length = struct.pack('@I', len(encoded_content))
    sys.stdout.buffer.write(encoded_length)
    sys.stdout.buffer.write(encoded_content)
    sys.stdout.buffer.flush()

def detect_ram_context():
    try:
        total_ram = psutil.virtual_memory().total / (1024 ** 3) # in GB
        if total_ram < 4.5: return 512
        if total_ram < 8.5: return 1024
        if total_ram < 16.5: return 2048
        return 4096
    except:
        return 1024 # Safe default

def main():
    llm = None
    
    # Pre-flight check / initialization
    try:
        if IMPORT_ERROR is not None:
            raise RuntimeError(f"Python dependency import failed: {IMPORT_ERROR}")

        host_dir = os.path.dirname(__file__)
        model_path = os.environ.get('CHERRY_MODEL_PATH', '').strip()
        if not model_path:
            candidates = [
                os.path.join(host_dir, 'cherry-ai-engine.gguf'),
                os.path.join(host_dir, 'qwen2.5-0.5b-instruct-q4_k_m.gguf'),
            ]
            model_path = next((candidate for candidate in candidates if os.path.exists(candidate)), '')

        if not model_path or not os.path.exists(model_path):
            raise Exception('Model not found. Expected cherry-ai-engine.gguf beside llm-host.py.')
        
        ctx_size = detect_ram_context()
        llm = Llama(model_path=model_path, n_ctx=ctx_size, verbose=False)
    except Exception as e:
        # If we fail to load model, wait for first message to send error, then die
        msg = get_message()
        send_message({"id": msg.get("id"), "error": f"LLM Init Error: {str(e)}"})
        sys.exit(1)

    while True:
        try:
            msg = get_message()
            prompt = msg.get("prompt", "")
            max_tokens = msg.get("max_tokens", 150)
            temp = msg.get("temperature", 0.75)
            stop_words = msg.get("stop_words") or ["</s>", "<|user|>", "<|assistant|>", "<start_of_turn>", "<end_of_turn>"]
            
            # Generate!
            output = llm(
                prompt,
                max_tokens=max_tokens,
                stop=stop_words,
                temperature=temp,
                echo=False # do not echo prompt
            )
            
            result_text = output['choices'][0]['text']
            send_message({
                "id": msg.get("id"),
                "text": result_text
            })
        except Exception as e:
            send_message({"id": msg.get("id", "0"), "error": str(e)})

if __name__ == '__main__':
    main()
