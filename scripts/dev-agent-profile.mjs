import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const defaultDebugProfileDir = path.join(os.homedir(), '.cherry-agent', 'chrome-debug');

const env = {
  ...process.env,
  CHERRY_ATTACHED_AUTO_LAUNCH: process.env.CHERRY_ATTACHED_AUTO_LAUNCH || 'true',
  CHERRY_ATTACHED_TAKEOVER_RUNNING: process.env.CHERRY_ATTACHED_TAKEOVER_RUNNING || 'true',
  CHERRY_RESTORE_LAST_SESSION: process.env.CHERRY_RESTORE_LAST_SESSION || 'true',
  CHERRY_CHROME_USER_DATA_DIR: process.env.CHERRY_CHROME_USER_DATA_DIR || defaultDebugProfileDir,
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'dev', '-w', '@cherry/agent'], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
