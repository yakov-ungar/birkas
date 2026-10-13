import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}

/** Builds one migrated template database; each test file copies it. */
export default function setup(project: TestProject) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dir = join(here, '.tmp');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const template = join(dir, 'template.db');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(here, '..'),
    env: { ...process.env, DATABASE_URL: `file:${template}` },
    stdio: 'pipe',
  });
  project.provide('templateDb', template);
  return () => rmSync(dir, { recursive: true, force: true });
}
