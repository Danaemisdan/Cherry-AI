import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const nativeHostDir = path.join(rootDir, 'native-host');
const releaseRoot = path.join(rootDir, 'release');
const bundleName = 'cherry-ai-portable';
const bundleDir = path.join(releaseRoot, bundleName);
const extensionDir = path.join(bundleDir, 'extension');
const runtimeDir = path.join(bundleDir, 'runtime');
const zipPath = path.join(releaseRoot, `${bundleName}.zip`);
const runtimeLauncherPath = path.join(runtimeDir, 'llm-host-launcher.sh');
const modelCandidates = [
  path.join(rootDir, 'Models', 'TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf'),
  path.join(rootDir, 'models', 'TinyLlama-1.1B-32k-Instruct-Q3_K_M.gguf'),
];
const modelSource = modelCandidates.find((candidate) => existsSync(candidate));

if (!modelSource) {
  throw new Error('Missing TinyLlama GGUF in Models/ or models/.');
}

const requiredFiles = [path.join(nativeHostDir, 'llm-host.py')];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing required release asset: ${path.relative(rootDir, file)}`);
  }
}

execFileSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });

rmSync(bundleDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(extensionDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });

cpSync(distDir, extensionDir, { recursive: true });

cpSync(path.join(nativeHostDir, 'llm-host.py'), path.join(runtimeDir, 'llm-host.py'));
cpSync(modelSource, path.join(runtimeDir, 'cherry-ai-engine.gguf'));

const runtimeLauncher = `#!/bin/bash
set -e
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
PYTHON_BIN="$(cat "$DIR/.python-bin")"
exec "$PYTHON_BIN" "$DIR/llm-host.py"
`;
writeFileSync(runtimeLauncherPath, runtimeLauncher, { mode: 0o755 });

const installer = `#!/bin/bash
# Cherry AI portable installer
set -e

echo "Installing Cherry AI local runtime..."

DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
EXTENSION_ID="ccogeoieogcdjbehbphfhccahmppajbp"
PYTHON_BIN="$(command -v python3)"

if [ -z "$PYTHON_BIN" ]; then
    echo "python3 was not found on this machine."
    exit 1
fi

mkdir -p "$MANIFEST_DIR"

printf '%s\n' "$PYTHON_BIN" > "$DIR/runtime/.python-bin"
chmod +x "$DIR/runtime/llm-host.py" "$DIR/runtime/llm-host-launcher.sh"

echo "Ensuring python dependencies..."
"$PYTHON_BIN" -m pip install --user llama-cpp-python psutil || true

cat << EOF > "$MANIFEST_DIR/com.cherryai.llm.json"
{
  "name": "com.cherryai.llm",
  "description": "Cherry AI local LLM processing via Cherry AI Engine",
  "path": "$DIR/runtime/llm-host-launcher.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "Cherry AI runtime installed."
echo "Keep this unzipped folder where it is. Chrome now points to its runtime/ directory directly."
echo "Load the extension/ folder in chrome://extensions if you have not done that yet."
`;
writeFileSync(path.join(bundleDir, 'install.command'), installer, { mode: 0o755 });

const readme = `Cherry AI portable bundle

What you send
- This single folder, or the zip made from it.

Client setup
1. Unzip the folder.
2. Open chrome://extensions and enable Developer mode.
3. Load the extension/ folder as unpacked.
4. Run install.command from the root of this folder.
5. Restart Chrome if native messaging was already open.

What is bundled
- extension/: production extension bundle with minified client-side JS
- runtime/llm-host.py: local native host
- runtime/cherry-ai-engine.gguf: renamed TinyLlama GGUF used for local generation

Notes
- The extension ID is stable in this build, so the installer does not need a manual ID.
- The installer registers the native host directly from this unzipped folder. Do not move or rename the folder after running install.command unless you rerun install.command.
- The shipped JS is minified, but browser extension code cannot be made fully secret without risking runtime breakage.
- The LLM runs locally on the client machine through Chrome native messaging. No public API fallback is used.
`;

writeFileSync(path.join(bundleDir, 'README.txt'), readme);

mkdirSync(releaseRoot, { recursive: true });
execFileSync('zip', ['-r', zipPath, bundleName], { cwd: releaseRoot, stdio: 'inherit' });

const modelSizeMb = Math.round(statSync(path.join(runtimeDir, 'cherry-ai-engine.gguf')).size / (1024 * 1024));
console.log(`Release bundle created at ${zipPath}`);
console.log(`Bundled model: cherry-ai-engine.gguf (${modelSizeMb} MB)`);
