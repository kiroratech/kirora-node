# Contributing

Thanks for helping improve `@kirora/node`.

## Questions and support

For help with your integration, email **support@kirora.io**. Issues are for bugs and
feature requests only.

## Security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).

## Reporting bugs

[Open an issue](../../issues/new/choose) using the bug report form. A minimal code
sample that reproduces the problem is the most useful thing you can include.

## Requesting features

Open an issue using the feature request form. Describe the problem you're trying to
solve, not just the solution. We read every request, but can't promise to build them
all.

## Pull requests

Small fixes (bugs, docs, typos) are welcome as pull requests directly. For new features
or changes to the public API, please open an issue first so we can agree on the approach.
Kirora's SDKs share the same API across platforms, so these changes need to be designed
together.

Before submitting:

- Add or update tests for your change. Tests mirror `src/`, so the tests for
  `src/resources/contacts.ts` go in `test/resources/contacts.test.ts`.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check`.
- Update the README if you changed public behaviour, and add a line to `CHANGELOG.md`
  under **Unreleased**.
- Don't edit `src/models.ts`, `src/error-codes.ts` or `src/webhook-events.ts` by hand.
  They're generated with `pnpm codegen` from the API spec that `spec/source.json` pins,
  and CI fails if they're out of date (`pnpm codegen:check`). Maintainers move the pin
  when the API changes, so pull requests shouldn't change it.
- When you add a resource method, follow [Adding a method](#adding-a-method).

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:package  # packs, installs and imports the package as a consumer would
```

### Updating the API spec

The error codes, webhook event names and types in `src/models.ts` are generated from
Kirora's OpenAPI spec, published at
[kiroratech/openapi](https://github.com/kiroratech/openapi). `spec/source.json` pins the
commit to generate from, with its `version` and `sha256`. To move to a newer spec, update
all three and run `pnpm codegen`.

It downloads the spec and refuses to run if it doesn't match `spec/source.json`; the
error prints the values to use. The download is cached in `node_modules/.cache`, so
later runs work offline. To try a spec that isn't published yet, pass its path:
`pnpm codegen path/to/openapi.json`. That skips the checksum and version checks, so
don't commit what it generates until the spec is published and pinned.
`pnpm codegen:check` regenerates everything in memory and fails if any generated file
differs. CI runs it on every change.

### Adding a method

- Name it after the `operationId` without the resource: `listContacts` is
  `contacts.list()`, `setContactTopic` is `contacts.setTopic()`. A bulk operation ends in
  `Batch`: `identifyContactsBatch` is `contacts.identifyBatch()`.
- Take path ids first, then the body, then the query (if any), then the call options.
- Name its types `<Verb><Thing>Params` for a body, `<Resource>ListQuery` or
  `<Thing>Query` for a query, and `<Resource>Page` for a page.
- Choose how it retries from the operation's `x-retry` in the spec: safe to repeat
  (`converges`, `read`) uses `unwrapRepeatable()` or `repeatable: true`; anything a
  repeat could fail or duplicate, if it takes an `Idempotency-Key`, uses
  `unwrapIdempotent()`.
- Add the `operationId` to `OPERATIONS` in `scripts/codegen.mjs`, run `pnpm codegen`,
  and add the method to `test/contract.test.ts`, which checks it resolves with what the
  API returns.
- The exported `components` and `operations` types only cover the operations in
  `OPERATIONS`, so removing one is a breaking change.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
