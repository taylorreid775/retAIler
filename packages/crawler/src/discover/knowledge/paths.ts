import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the monorepo docs/discovery root (override with DISCOVERY_DOCS_ROOT). */
export function resolveDiscoveryDocsRoot(): string {
  if (process.env.DISCOVERY_DOCS_ROOT) {
    return resolve(process.env.DISCOVERY_DOCS_ROOT);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let dir = moduleDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'docs', 'discovery');
    if (existsSync(join(candidate, 'templates'))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(process.cwd(), 'docs', 'discovery');
}

export function retailerKnowledgeDir(retailerKey: string): string {
  return join(resolveDiscoveryDocsRoot(), 'retailers', retailerKey);
}
