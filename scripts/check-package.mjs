/**
 * Packs the SDK as it would be published, installs the tarball into a throwaway consumer
 * and checks that it imports and requires at runtime and type-checks under each module
 * setting a TypeScript consumer is likely to use:
 *
 *   pnpm check:package [path/to/package.tgz]
 *
 * Given a tarball, it checks that one instead of packing a new one, so a release can
 * publish exactly what was checked.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'kirora-package-'));
const run = async (command, args, cwd) => (await execFile(command, args, { cwd })).stdout;

const settings = {
  nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
  node16: { module: 'Node16', moduleResolution: 'Node16' },
  bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
  // For CommonJS projects that predate `exports`, which read `main` and `types`.
  node10: { module: 'CommonJS', moduleResolution: 'Node10' },
};

/** Every file path in an `exports` entry, however deeply its conditions nest. */
const targets = (entry) =>
  typeof entry === 'string' ? [entry] : Object.values(entry).flatMap(targets);

try {
  const given = process.argv[2];
  let tarball;
  if (given === undefined) {
    // `pnpm pack` runs `prepack`, so this also checks the package builds itself.
    await run('pnpm', ['pack', '--pack-destination', work], root);
    tarball = join(
      work,
      `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`,
    );
  } else {
    tarball = resolve(given);
  }
  const files = new Set(
    (await run('tar', ['-tzf', tarball], work))
      .split('\n')
      .map((file) => file.replace(/^package\//, '')),
  );
  for (const target of [...targets(pkg.exports['.']), pkg.main, pkg.types]) {
    if (!files.has(target.replace(/^\.\//, ''))) {
      throw new Error(`${target} is in package.json but missing from the tarball`);
    }
  }

  // The package has no dependencies, so installing it is just unpacking it.
  const consumer = join(work, 'consumer');
  const installed = join(consumer, 'node_modules', pkg.name);
  mkdirSync(installed, { recursive: true });
  await run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1'], work);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  // The same source twice: index.ts imports the package, and in index.cts TypeScript reads
  // the import as require().
  const source = `import { Kirora, KiroraError, createUserToken, type ContactsPage } from '${pkg.name}';
const kirora: Kirora = new Kirora({ apiKey: 'kirora_test' });
const count: ContactsPage['meta']['count'] = null;
export async function first(): Promise<string | undefined> {
  const page = await kirora.contacts.list();
  for await (const contact of kirora.contacts.list()) return contact.email ?? undefined;
  return page.lastResponse.requestId;
}
void [count, KiroraError, createUserToken];
`;
  writeFileSync(join(consumer, 'index.ts'), source);
  writeFileSync(join(consumer, 'index.cts'), source);
  for (const [name, options] of Object.entries(settings)) {
    writeFileSync(
      join(consumer, `tsconfig.${name}.json`),
      JSON.stringify({
        compilerOptions: {
          ...options,
          target: 'ES2022',
          strict: true,
          noEmit: true,
          // This repo's @types/node, rather than installing it for the consumer.
          typeRoots: [join(root, 'node_modules/@types')],
          types: ['node'],
        },
        files: ['index.ts', 'index.cts'],
      }),
    );
  }

  // Importing and requiring the installed package must both give the CommonJS build's
  // exports, as the same objects, so `instanceof` works across them.
  const expected = JSON.stringify(
    Object.keys(
      createRequire(import.meta.url)(join(root, pkg.exports['.'].require.default)),
    ).sort(),
  );
  const tsc = join(root, 'node_modules/typescript/bin/tsc');
  const [imported, required] = await Promise.all([
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        // Node adds these two to the ES module view of any CommonJS module.
        `import { createRequire } from 'node:module';
const ignored = ['__esModule', 'module.exports'];
const imported = await import('${pkg.name}');
const required = createRequire(import.meta.url)('${pkg.name}');
console.log(JSON.stringify(Object.keys(imported).filter((name) => !ignored.includes(name)).sort()));
console.log(Object.keys(required).filter((name) => imported[name] !== required[name]).join(', '));`,
      ],
      consumer,
    ),
    run(
      process.execPath,
      [
        '--input-type=commonjs',
        '-e',
        `console.log(require.resolve('${pkg.name}'));
console.log(JSON.stringify(Object.keys(require('${pkg.name}')).sort()))`,
      ],
      consumer,
    ),
    ...Object.keys(settings).map((name) =>
      run(process.execPath, [tsc, '-p', `tsconfig.${name}.json`], consumer),
    ),
  ]);
  const [importedKeys, mixed = ''] = imported.trim().split('\n');
  const [requiredPath, requiredKeys] = required.trim().split('\n');
  for (const [verb, keys] of [
    ['Importing', importedKeys],
    ['Requiring', requiredKeys],
  ]) {
    if (keys !== expected) {
      throw new Error(`${verb} the installed package gives ${keys}, not ${expected}`);
    }
  }
  if (mixed) {
    throw new Error(`import and require() give different copies of ${mixed}`);
  }
  if (!requiredPath.endsWith(join('dist', 'cjs', 'index.js'))) {
    throw new Error(`require() loads ${requiredPath}, not the CommonJS build`);
  }
  process.stdout.write(
    `${pkg.name} installs, imports, requires and type-checks under ${Object.keys(settings).join(', ')}\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
