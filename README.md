# Kirora Node.js SDK

Use the Kirora API from Node.js to manage contacts, track events, and send campaigns
and transactional messages.

[Node.js guide](https://kirora.io/docs/sdks/node) ·
[API reference](https://kirora.io/docs/api/reference) ·
[Usage guide](docs/usage.md) · [Changelog](CHANGELOG.md)

- TypeScript types generated from Kirora's OpenAPI specification.
- Automatic pagination and retries, with idempotency keys for supported operations.
- Webhook verification, user token signing, and partner workspace support.
- No runtime dependencies; supports ES modules and CommonJS.

## Contents

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Pagination](#pagination)
- [Errors](#errors)
- [Configuration](#configuration)
- [Retries and idempotency](#retries-and-idempotency)
- [More guides](#more-guides)
- [Compatibility](#compatibility) and [help](#help-and-contributing)

## Installation

Requires **Node.js 20.3 or later**, and **TypeScript 5.0 or later** if you use
TypeScript: the type declarations use `export type *`, which TypeScript 4.x can't read.

```sh
npm install @kirora/node
# or
pnpm add @kirora/node
# or
yarn add @kirora/node
```

Create an API key in the Kirora dashboard and set it in your server's environment:

```sh
export KIRORA_API_KEY="your_api_key"
```

Keep the key on your server. For browser and mobile apps, use
[server-issued user tokens](docs/usage.md#create-browser-and-mobile-sdk-tokens).

## Quickstart

Save this as `quickstart.mjs`. It creates or updates a contact in your workspace.
Replace the sample external ID and email with your own test values.

```js
import { Kirora } from '@kirora/node';

const kirora = new Kirora(); // Reads KIRORA_API_KEY.

try {
  const contact = await kirora.contacts.identify({
    externalId: 'example-user-123',
    email: 'ada@example.com',
  });
  console.log('Contact ID:', contact.id);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
```

Run it:

```sh
node quickstart.mjs
```

A successful request prints `Contact ID: <contact ID>`. To check credentials without
creating data, call `await kirora.me()` instead.

The `.mjs` extension enables ES modules and top-level `await` without changing your
project's `package.json`. In CommonJS, use
`const { Kirora } = require('@kirora/node');` and put awaited calls in an async function.
TypeScript uses the same named imports and includes request and response types.

## Usage

The following snippets assume a `kirora` client initialized as in the quickstart.
Run them inside an async function or an ES module. Methods return the result directly
and throw on failure; see [error handling](#errors).

### Contacts

`identify()` creates or updates a contact, matching by external ID, then email, then
phone. Retrieve and update a contact by email:

```ts
const contact = await kirora.contacts.get('ada@example.com', { idType: 'email' });
await kirora.contacts.update(contact.id, { firstName: 'Ada' });
```

Methods use Kirora IDs by default. Pass `{ idType: 'externalId' }` or
`{ idType: 'email' }` to use another identifier. Omit an update field to keep its current
value; use `null` to clear a nullable field. See [optional fields](docs/usage.md#optional-fields).

### Events

Track an event for an existing contact:

```ts
await kirora.events.track(
  {
    externalId: 'example-user-123',
    name: 'Order Completed',
    properties: { orderId: 'order-123', total: 49.99, currency: 'GBP' },
  },
  { idempotencyKey: 'order-123-completed' },
);
```

Derive the idempotency key from the operation in your application, and reuse it when
retrying that same operation with the same body.

### Transactional messages

Complete your workspace's email sending setup and configure an email template first.
Replace `order-receipt` with your template's alias or ID and use a recipient you control.

```ts
const { messages } = await kirora.transactional.send(
  {
    to: { email: 'customer@example.com' },
    data: { orderId: 'order-123' },
    email: { template: 'order-receipt' },
  },
  { idempotencyKey: 'receipt-order-123' },
);
console.log(messages);
```

A send can succeed with a channel left unsent, such as push for a contact without a
device: check the result's `skippedChannels`.

`events.trackBatch()` and `transactional.sendBatch()` accept up to 100 entries.
Check each entry in `results` for errors even when the call succeeds. Set each entry's
`idempotencyKey` when retrying batches from your application. See [batch requests](docs/usage.md#batch-requests).

<a id="campaigns"></a>
<a id="lists"></a>
<a id="messages-and-suppressions"></a>

### Resources

| Resource        | Use it to                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| `contacts`      | Identify, update, merge, export, and delete contacts; manage preferences and push devices. |
| `events`        | Track individual events or batches.                                                        |
| `transactional` | Send messages individually or in batches; cancel scheduled messages.                       |
| `campaigns`     | Create campaigns, check eligibility, send, and schedule.                                   |
| `lists`         | Create lists and manage membership.                                                        |
| `messages`      | Inspect sent messages.                                                                     |
| `suppressions`  | Manage suppressed email addresses.                                                         |
| `workspaces`    | Manage tenant workspaces with a partner key.                                               |
| `embedSessions` | Create sessions for embedded Kirora builders.                                              |

See [resource examples](docs/usage.md#usage) and the
[API reference](https://kirora.io/docs/api/reference) for endpoint requirements.

## Pagination

Use `for await` to fetch matching items across pages automatically:

```ts
for await (const contact of kirora.contacts.list({ query: 'ada' })) {
  console.log(contact.id, contact.email);
}
```

Use `break` to stop fetching more pages. To fetch a single page, `await` the same method:

```ts
const page = await kirora.contacts.list({ query: 'ada' });
console.log(page.data, page.meta.pagination.nextCursor);
```

Requests start when you await or iterate. See [pagination details](docs/usage.md#pagination)
for cursor handling and how awaiting and iterating the same list interact.

## Errors

API failures throw `KiroraError`. Branch on `code` and include `requestId` when
reporting a failure:

```ts
import { KiroraError } from '@kirora/node';

try {
  const contact = await kirora.contacts.get('example-user-123', { idType: 'externalId' });
  console.log(contact.id);
} catch (error) {
  if (error instanceof KiroraError) {
    console.error('Kirora request failed', {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  }
  throw error;
}
```

Use `error.code === 'NOT_FOUND'` to handle a missing contact, or inspect `error.errors`
for field-level validation failures. Other failures throw `KiroraConnectionError`,
`KiroraTimeoutError`, or `KiroraResponseError`. Cancelling a call can reject with the
abort signal's reason. See [error details](docs/usage.md#errors) and the
[API error codes](https://kirora.io/docs/api/reference/errors).

## Configuration

Create one client and reuse it. `new Kirora()` reads `KIRORA_API_KEY`; pass `apiKey`
to supply a key directly:

```ts
const kirora = new Kirora({
  timeoutMs: 10_000,
  retry: { maxRetries: 2 },
});
```

| Option             | Default                                      | Purpose                                                                |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| `apiKey`           | `KIRORA_API_KEY`                             | Authenticate requests; the constructor throws if no key is available.  |
| `baseUrl`          | `KIRORA_BASE_URL` or `https://api.kirora.io` | Set the API's address, without `/v1`; a query or fragment throws.      |
| `timeoutMs`        | `30000`                                      | Limit each attempt, including reading the response.                    |
| `retry.maxRetries` | `3`                                          | Allow 0–10 retries after the first attempt.                            |
| `retry.maxDelayMs` | `30000`                                      | Limit the wait between attempts; a longer `Retry-After` stops retries. |
| `fetch`            | `globalThis.fetch`                           | Use a custom fetch implementation or test stub.                        |
| `workspace`        | None                                         | Scope a partner key to a tenant's external ID.                         |
| `appInfo`          | None                                         | Add your app's name and optional version to the `User-Agent`.          |
| `headers`          | None                                         | Add headers; the SDK's own headers take precedence.                    |

### Cancellation and per-call options

Pass options as the final argument to override a call's `timeoutMs`, `maxRetries`,
`headers`, or `workspace`, or to supply an abort `signal`:

```ts
const contact = await kirora.contacts.get(
  'example-user-123',
  { idType: 'externalId' },
  { signal: AbortSignal.timeout(15_000), maxRetries: 0 },
);
console.log(contact.id);
```

Use a signal to limit the **total** time, including retries; `timeoutMs` limits each
attempt separately. For contact methods with a query argument, pass `{}` before the
call options when using a Kirora ID. See [configuration details](docs/usage.md#configuration).

## Retries and idempotency

The SDK allows up to **3 retries** by default, with exponential backoff and jitter:

- Rate limits (429) and failures that never established a connection can be retried.
- Other network failures and 5xx responses are retried only when repeating the operation is safe.
- `IDEMPOTENCY_KEY_IN_USE` can be retried when the call is safe to repeat.
- Other 4xx responses and cancelled calls are not retried.
- Redirects aren't followed: a redirected call throws `KiroraResponseError` and isn't
  retried, so check `baseUrl`.

Set `retry: { maxRetries: 0 }` on the client, or `maxRetries: 0` on a call, to disable
retries. See [retry details](docs/usage.md#retry-behavior) for operation-specific rules.

For supported operations, the SDK generates an idempotency key per call and reuses it
for its own retries. Separate calls get separate keys. Pass a stable `idempotencyKey`
to deduplicate retries from your application, as in the event and transactional examples.
Reuse a key only for the same operation and request body.

Idempotency keys apply to individual calls; setting an `Idempotency-Key` header on the
client throws. Keys expire; see the [API idempotency rules](https://kirora.io/docs/api/reference/idempotency).

<a id="advanced-usage"></a>

## More guides

The [usage guide](docs/usage.md) covers data handling and advanced integrations:

| Topic             | Guide                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Data and types    | [Optional fields and nullable values](docs/usage.md#optional-fields)                             |
| Batch requests    | [Per-entry errors and idempotency keys](docs/usage.md#batch-requests)                            |
| Response metadata | [Request IDs, rate limits, and idempotency replays](docs/usage.md#response-details)              |
| Other endpoints   | [Custom requests and streaming responses](docs/usage.md#call-endpoints-without-resource-methods) |
| Testing           | [Stub fetch without making API calls](docs/usage.md#testing-your-code)                           |

### Verify webhooks

Verify the raw request body with `verifyWebhook()` before parsing it. Webhooks can
arrive more than once; deduplicate using the verified `payload.eventId`, and record an
event as handled only once its work has succeeded, so a failed delivery is handled again
when it's retried.
See [Express and Next.js handlers](docs/usage.md#verify-webhooks) and
[verification diagnostics](docs/usage.md#verification-diagnostics).

<a id="create-browser-and-mobile-sdk-tokens"></a>
<a id="manage-tenant-workspaces"></a>
<a id="batch-requests"></a>
<a id="response-details"></a>
<a id="call-endpoints-without-resource-methods"></a>

Use [server-issued tokens](docs/usage.md#create-browser-and-mobile-sdk-tokens) to
authenticate browser and mobile SDK users. For partner integrations, see
[tenant workspaces and embed sessions](docs/usage.md#manage-tenant-workspaces).

## Compatibility

- **Runtime:** Node.js 20.3 or later; CI tests Node.js 20, 22, and 24.
- **Modules:** ES modules and CommonJS share the same implementation, so
  `instanceof KiroraError` works across `import` and `require()`.
- **TypeScript:** 5.0 or later; 4.x can't read the type declarations. Types are tested
  with TypeScript 5.8 under `NodeNext`, `Node16`, `Bundler`, and `Node10` module
  settings, from ES modules and CommonJS.
- **API and releases:** targets `/v1`. Unknown error codes and event types pass through
  as strings. Before 1.0, minor releases may include breaking changes; review the
  [changelog](CHANGELOG.md) when upgrading.

## Help and contributing

For SDK bugs or feature requests, [open an issue](https://github.com/kiroratech/kirora-node/issues).
Include your SDK and Node.js versions, a minimal reproduction, and the request ID when
available. Remove API keys, tokens, and personal data before sharing logs.

For integration help, start with the [Node.js guide](https://kirora.io/docs/sdks/node)
or contact **support@kirora.io**. See
[contributing](https://github.com/kiroratech/kirora-node/blob/main/CONTRIBUTING.md) for
development setup and checks, and
[security reporting](https://github.com/kiroratech/kirora-node/blob/main/SECURITY.md) for
vulnerabilities.

## License

[MIT](LICENSE)
