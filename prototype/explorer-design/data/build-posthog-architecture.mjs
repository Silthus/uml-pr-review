import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const repo = '/Users/mreichenbach/dev/posthog';
const out = '/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a5ed9c31c17d7a089/prototype/explorer-design/data/posthog-architecture.json';
const textExt = new Set(['.py', '.ts', '.tsx', '.js', '.jsx']);

const files = execFileSync('/usr/bin/git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter(
    (file) =>
      textExt.has(path.extname(file)) &&
      !file.includes('/node_modules/') &&
      !file.includes('/migrations/') &&
      !file.includes('/__snapshots__/') &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.spec.ts'),
  );

function moduleFor(file) {
  const parts = file.split('/');
  if (parts[0] === 'products' && parts[1]) {
    const side = ['frontend', 'backend'].includes(parts[2]) ? parts[2] : 'shared';
    return `products/${parts[1]}/${side}`;
  }
  if (parts[0] === 'posthog') {
    if (['models', 'api', 'tasks', 'temporal', 'hogql', 'warehouse', 'event_usage', 'management'].includes(parts[1])) {
      return `posthog/${parts[1]}`;
    }
    return 'posthog/core';
  }
  if (parts[0] === 'frontend') {
    if (parts[1] === 'src' && parts[2]) return `frontend/${parts[2]}`;
    return 'frontend';
  }
  if (parts[0] === 'ee') return parts[1] ? `ee/${parts[1]}` : 'ee';
  if (parts[0] === 'common') return parts[1] ? `common/${parts[1]}` : 'common';
  if (parts[0] === 'plugin-server') return parts[1] ? `plugin-server/${parts[1]}` : 'plugin-server';
  if (parts[0] === 'rust') return parts[1] ? `rust/${parts[1]}` : 'rust';
  return parts[0];
}

const moduleFiles = new Map();
for (const file of files) {
  const module = moduleFor(file);
  if (!moduleFiles.has(module)) moduleFiles.set(module, []);
  moduleFiles.get(module).push(file);
}

const moduleIds = [...moduleFiles.keys()].sort((a, b) => b.length - a.length);
const modules = [...moduleFiles.entries()].map(([id, moduleFiles]) => ({
  id,
  name: id.split('/').at(-1),
  path: id,
  kind: id.startsWith('products/')
    ? 'product'
    : id.startsWith('frontend/')
      ? 'frontend'
      : id.startsWith('posthog/') || id.startsWith('ee/')
        ? 'backend'
        : 'package',
  files: moduleFiles.length,
  samples: moduleFiles.slice(0, 6),
}));

function resolveImport(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('@') || spec.startsWith('http')) return null;
  for (const id of moduleIds) {
    if (spec === id || spec.startsWith(`${id}/`)) return id;
  }
  if (spec.startsWith('posthog.')) return moduleFor(`${spec.replaceAll('.', '/')}.py`);
  if (spec.startsWith('products.')) return moduleFor(`${spec.replaceAll('.', '/')}.py`);
  if (spec.startsWith('ee.')) return moduleFor(`${spec.replaceAll('.', '/')}.py`);
  if (spec.startsWith('frontend/')) return moduleFor(`${spec}.ts`);
  return null;
}

const importRegexes = [
  /(?:import|export)\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /from\s+([a-zA-Z0-9_.]+)\s+import\s+/g,
  /import\s+([a-zA-Z0-9_.]+)\s*$/gm,
];
const edgeMap = new Map();
for (const file of files.slice(0, 14_000)) {
  const source = moduleFor(file);
  let content = '';
  try {
    content = execFileSync('/usr/bin/git', ['-C', repo, 'cat-file', '-p', `HEAD:${file}`], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
  } catch {
    continue;
  }
  for (const re of importRegexes) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content))) {
      const target = resolveImport(match[1]);
      if (!target || !moduleFiles.has(target) || target === source) continue;
      const key = `${source}→${target}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { source, target, count: 0, evidence: [] });
      const edge = edgeMap.get(key);
      edge.count += 1;
      if (edge.evidence.length < 6) edge.evidence.push({ from: file, import: match[1] });
    }
  }
}

const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count).slice(0, 320);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedFrom: repo, generatedAt: new Date().toISOString(), modules, edges }, null, 2));
console.log(JSON.stringify({ modules: modules.length, edges: edges.length, out }, null, 2));
