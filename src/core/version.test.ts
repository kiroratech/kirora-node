import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { VERSION } from './version.js';

describe('VERSION', () => {
  it('matches package.json, so the User-Agent names the published version', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
