/**
 * Builds the package as CommonJS in dist/cjs, and gives `import` an ES module in
 * dist/esm that re-exports it. With one copy of every class, `instanceof` works however
 * the package is loaded.
 *
 *   pnpm build
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = (path) => new URL(`../dist/${path}`, import.meta.url);
const reexport = "export * from '../cjs/index.js';\n";

rmSync(dist(''), { recursive: true, force: true });
execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' },
);
// The package is "type": "module", so without this Node and TypeScript would read the
// CommonJS build's .js and .d.ts files as ES modules.
writeFileSync(dist('cjs/package.json'), '{ "type": "commonjs" }\n');
mkdirSync(dist('esm'));
writeFileSync(dist('esm/index.js'), reexport);
writeFileSync(dist('esm/index.d.ts'), reexport);
