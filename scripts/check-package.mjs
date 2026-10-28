/**
 * Packs the SDK as it would be published, installs the tarball into a throwaway consumer
 * and checks that it imports at runtime and type-checks under each module setting a
 * TypeScript consumer is likely to use:
 *
 *   pnpm check:package [path/to/package.tgz]
 *
 * Given a tarball, it checks that one instead of packing a new one, so a release can
 * publish exactly what was checked.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'kirora-package-'));
const run = async (command, args, cwd) => (await execFile(command, args, { cwd })).stdout;

// The package is ESM only, so CommonJS consumers aren't checked.
const settings = {
  nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
  node16: { module: 'Node16', moduleResolution: 'Node16' },
  bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
};

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
  for (const target of Object.values(pkg.exports['.'])) {
    if (!files.has(target.replace(/^\.\//, ''))) {
      throw new Error(`${target} is declared in exports but missing from the tarball`);
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
  writeFileSync(
    join(consumer, 'index.ts'),
    `import { Kirora, KiroraError, createUserToken, type ContactsPage } from '${pkg.name}';
const kirora: Kirora = new Kirora({ apiKey: 'kirora_test' });
const count: ContactsPage['meta']['count'] = null;
export async function first(): Promise<string | undefined> {
  const page = await kirora.contacts.list();
  for await (const contact of kirora.contacts.list()) return contact.email ?? undefined;
  return page.lastResponse.requestId;
}
void [count, KiroraError, createUserToken];
`,
  );
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
        files: ['index.ts'],
      }),
    );
  }

  // The installed package must export everything the local build does.
  const expected = JSON.stringify(
    Object.keys(await import(pathToFileURL(join(root, 'dist/index.js')).href)).sort(),
  );
  const tsc = join(root, 'node_modules/.bin/tsc');
  const [exported] = await Promise.all([
    run(
      'node',
      [
        '--input-type=module',
        '-e',
        `console.log(JSON.stringify(Object.keys(await import('${pkg.name}')).sort()))`,
      ],
      consumer,
    ),
    ...Object.keys(settings).map((name) =>
      run(tsc, ['-p', `tsconfig.${name}.json`], consumer),
    ),
  ]);
  if (exported.trim() !== expected) {
    throw new Error(`The installed package exports ${exported}, not ${expected}`);
  }
  process.stdout.write(
    `${pkg.name} installs, imports and type-checks under ${Object.keys(settings).join(', ')}\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
