#!/bin/bash
# Cherry AI - Mac Native Host Installer
set -e

echo "🍒 Installing Cherry AI LLM Host..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TARGET_DIR="$HOME/.cherry-ai"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
EXTENSION_ID="ccogeoieogcdjbehbphfhccahmppajbp"
PYTHON_BIN="$(command -v python3)"

if [ -z "$PYTHON_BIN" ]; then
    echo "python3 was not found on this machine."
    exit 1
fi

mkdir -p "$TARGET_DIR"
mkdir -p "$MANIFEST_DIR"

# Copy python host
cp "$DIR/llm-host.py" "$TARGET_DIR/llm-host.py"
chmod +x "$TARGET_DIR/llm-host.py"
cat > "$TARGET_DIR/llm-host-launcher.sh" <<EOF
#!/bin/bash
exec "$PYTHON_BIN" "$TARGET_DIR/llm-host.py"
EOF
chmod +x "$TARGET_DIR/llm-host-launcher.sh"

# Copy bundled GGUF if present, otherwise source it from the workspace models folder
cd "$TARGET_DIR"
if [ -f "$DIR/cherry-ai-engine.gguf" ]; then
    cp "$DIR/cherry-ai-engine.gguf" "$TARGET_DIR/cherry-ai-engine.gguf"
elif [ -f "$DIR/../Models/TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf" ]; then
    cp "$DIR/../Models/TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf" "$TARGET_DIR/cherry-ai-engine.gguf"
elif [ -f "$DIR/../models/TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf" ]; then
    cp "$DIR/../models/TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf" "$TARGET_DIR/cherry-ai-engine.gguf"
else
    echo "Bundled TinyLlama GGUF was not found."
    exit 1
fi

# Install python dependencies for local llama.cpp
echo "Ensuring python dependencies..."
"$PYTHON_BIN" -m pip install --user llama-cpp-python psutil || true

cat << EOF > "$MANIFEST_DIR/com.cherryai.llm.json"
{
  "name": "com.cherryai.llm",
  "description": "Cherry AI local LLM processing via Cherry AI Engine",
  "path": "$TARGET_DIR/llm-host-launcher.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "✅ Native Messaging Host Installed!"
echo "Model is ready at $TARGET_DIR."
echo "You can close this window."
