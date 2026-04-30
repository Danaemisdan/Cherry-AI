import fs from 'node:fs';
import path from 'node:path';
import { createId } from '@cherry/shared';

export class ArtifactStore {
  constructor(rootDir = path.resolve(process.cwd(), '.cherry-agent/artifacts')) {
    this.rootDir = rootDir;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  writeJson(data, prefix = 'artifact') {
    const artifactId = createId(prefix);
    const filename = `${artifactId}.json`;
    const filePath = path.join(this.rootDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { artifactId, filePath, kind: 'json' };
  }

  writeCsv(rows, prefix = 'artifact') {
    const artifactId = createId(prefix);
    const filename = `${artifactId}.csv`;
    const filePath = path.join(this.rootDir, filename);
    const headers = Object.keys(rows[0] || {});
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((header) => JSON.stringify(row[header] ?? '')).join(','));
    }
    fs.writeFileSync(filePath, lines.join('\n'));
    return { artifactId, filePath, kind: 'csv' };
  }
}
