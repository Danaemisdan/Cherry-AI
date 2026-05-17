#!/usr/bin/env node
/**
 * Cherry AI — unified dev launcher
 * Starts: LLM server (Python) + backend + agent + web frontend
 *
 * Usage:  npm run dev
 *   or:   node start.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ── Colour-coded log prefix per service ────────────────────────────────────
const C = { llm:'\x1b[35m', backend:'\x1b[36m', agent:'\x1b[33m', web:'\x1b[32m', rst:'\x1b[0m' };
const pre = (name) => `${C[name]||''}[${name.padEnd(7)}]${C.rst} `;

// ── Spawn a service and pipe its stdout/stderr with a colour prefix ─────────
function launch(name, cmd, args, cwd = ROOT) {
  process.stdout.write(`${pre(name)}▶ ${cmd} ${args.join(' ')}\n`);

  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const write = (stream, data) =>
    String(data).trimEnd().split('\n')
      .forEach(line => stream.write(pre(name) + line + '\n'));

  proc.stdout.on('data', d => write(process.stdout, d));
  proc.stderr.on('data', d => write(process.stderr, d));
  proc.on('exit', code => {
    if (code !== 0 && code !== null)
      process.stderr.write(`${pre(name)}exited with code ${code}\n`);
  });

  return proc;
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const procs = [];

// ── Banner ──────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m\x1b[35m🍒  Cherry AI — starting all services\x1b[0m');
console.log('\x1b[90m    LLM     → http://localhost:11434');
console.log('    Backend → http://localhost:8787');
console.log('    Web     → http://localhost:5173\x1b[0m\n');

// ── 1. Local LLM (Python) ───────────────────────────────────────────────────
const llmScript = resolve(ROOT, 'llm_server.py');
if (existsSync(llmScript)) {
  procs.push(launch('llm', 'python3', ['llm_server.py']));
  await delay(400);
} else {
  console.warn(`${pre('llm')}llm_server.py not found — skipping LLM`);
}

// ── 2. Backend ──────────────────────────────────────────────────────────────
procs.push(launch('backend', 'npm', ['run', 'dev', '-w', '@cherry/backend']));
await delay(400);

// ── 3. Agent ───────────────────────────────────────────────────────────────
procs.push(launch('agent', 'npm', ['run', 'dev', '-w', '@cherry/agent']));
await delay(400);

// ── 4. Web frontend ─────────────────────────────────────────────────────────
procs.push(launch('web', 'npm', ['run', 'dev', '-w', '@cherry/web']));

// ── Graceful shutdown on Ctrl+C ─────────────────────────────────────────────
const shutdown = () => {
  console.log('\n\x1b[90m🍒  Stopping all Cherry services…\x1b[0m');
  procs.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
