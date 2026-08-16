// Bundles the ES modules, CSS and markup into one self-contained HTML file
// that runs from a plain file:// double-click — no server, no build tooling.
//
//   node tools/build.mjs
//
// Outputs:
//   dist/voxel-world.html   complete standalone document
//   dist/embed.html         same game as a body fragment (for embedding)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

const read = (p) => readFileSync(p, 'utf8');

/** Collects modules depth-first so every dependency is registered first. */
function collect(entry, seen = new Set(), out = []) {
  const key = basename(entry);
  if (seen.has(key)) return out;
  seen.add(key);
  const src = read(resolve(SRC, key));
  for (const m of src.matchAll(/^import\s+.*?from\s+'\.\/([\w.-]+)';/gms)) {
    collect(m[1], seen, out);
  }
  out.push(key);
  return out;
}

/** Rewrites one ES module into a factory function returning its exports. */
function wrap(key) {
  let src = read(resolve(SRC, key));
  const names = new Set();

  src = src.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'\.\/([\w.-]+)';/gm,
    (_, ns, dep) => `const ${ns} = __req('${dep}');`);
  src = src.replace(/^import\s+\{([^}]+)\}\s+from\s+'\.\/([\w.-]+)';/gms,
    (_, list, dep) => `const {${list}} = __req('${dep}');`);

  src = src.replace(/^export\s+(const|let|var)\s+(\w+)/gm, (_, kw, n) => {
    names.add(n);
    return `${kw} ${n}`;
  });
  src = src.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_, async_, n) => {
    names.add(n);
    return `${async_ || ''}function ${n}`;
  });
  src = src.replace(/^export\s+class\s+(\w+)/gm, (_, n) => {
    names.add(n);
    return `class ${n}`;
  });
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, list) => {
    for (const part of list.split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
    return '';
  });

  if (/^\s*(export|import)\s/m.test(src)) {
    throw new Error(`unhandled import/export syntax in ${key}`);
  }
  return `__mods['${key}'] = function () {\n${src}\nreturn { ${[...names].join(', ')} };\n};`;
}

const modules = collect('main.js');
const bundle = `// Bundled from src/*.js — see the repository for the readable sources.
const __mods = {};
const __cache = {};
function __req(name) {
  const key = name.replace('./', '');
  if (!(key in __cache)) {
    if (!__mods[key]) throw new Error('missing module ' + key);
    __cache[key] = __mods[key]();
  }
  return __cache[key];
}
${modules.map(wrap).join('\n\n')}
__req('main.js');
`;

const css = read(resolve(ROOT, 'style.css'));
const html = read(resolve(ROOT, 'index.html'));
const body = html.split('<body>')[1].split('</body>')[0]
  .replace(/\s*<script[^>]*><\/script>/, '')
  .trim();

const TITLE = '方塊世界 Voxel World';
const fragment = `<title>${TITLE}</title>
<style>
${css}</style>
${body}
<script type="module">
${bundle}</script>`;

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
writeFileSync(resolve(ROOT, 'dist/embed.html'), fragment);
writeFileSync(resolve(ROOT, 'dist/voxel-world.html'),
  `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${fragment.split('\n').slice(0, 1).join('')}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%2360a03e'/><rect y='6' width='16' height='10' fill='%23866044'/></svg>">
<style>
${css}</style>
</head>
<body>
${body}
<script type="module">
${bundle}</script>
</body>
</html>
`);

const size = (p) => (readFileSync(resolve(ROOT, p)).length / 1024).toFixed(0) + ' KB';
console.log(`bundled ${modules.length} modules: ${modules.join(', ')}`);
console.log(`dist/voxel-world.html  ${size('dist/voxel-world.html')}`);
console.log(`dist/embed.html        ${size('dist/embed.html')}`);
