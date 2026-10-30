# @kirora/node

The Kirora SDK for Node.js. Manage contacts, track events, send campaigns and
transactional messages, verify webhooks and sign users in to Kirora's browser and mobile
SDKs.

- Written in TypeScript, with types generated from the Kirora OpenAPI spec
- Automatic pagination, retries with backoff and idempotency keys
- No runtime dependencies. Requires Node.js 20.3 or later
- Works with both `import` and `require()`

**Docs:** [Node.js guide](https://kirora.io/docs/sdks/node) ·
[API reference](https://kirora.io/docs/api/reference) ·
[Authentication](https://kirora.io/docs/api/reference/authentication) ·
[Error codes](https://kirora.io/docs/api/reference/errors) ·
[Webhooks](https://kirora.io/docs/api/reference/webhooks) ·
[Changelog](CHANGELOG.md)

**Contents:** [Quickstart](#quickstart) · [Usage](#usage) ·
[Pagination](#pagination) · [Idempotency](#idempotency) ·
[Other endpoints](#other-endpoints) · [Signing users in](#signing-users-in-to-the-browser-sdk) ·
[Webhooks](#webhooks) · [Errors](#errors) · [Retries](#retries) ·
[Compatibility](#compatibility) · [Partner workspaces](#partner-workspaces)

## Installation

```sh
# npm
npm install @kirora/node

# pnpm
pnpm add @kirora/node

# Yarn
yarn add @kirora/node
```

## Quickstart

Create an API key in the Kirora dashboard and keep it on your server. Then save this as
`quickstart.mjs`:

```js
import { Kirora } from '@kirora/node';

const kirora = new Kirora(); // reads KIRORA_API_KEY
const { apiKey, workspace } = await kirora.me();
console.log(
  `Connected to ${workspace.name} with the ${apiKey.kind} key "${apiKey.name}"`,
);
```

and run it:

```sh
KIRORA_API_KEY=your_key node quickstart.mjs
```

The quickstart is a `.mjs` file so it can use `await` at the top level. In CommonJS, load
the SDK with `const { Kirora } = require('@kirora/node');`. The examples below are
TypeScript, but work the same in JavaScript.

## Usage

```ts
import { Kirora } from '@kirora/node';

const kirora = new Kirora(); // reads KIRORA_API_KEY
```

Or pass options:

| Option             | Default                                         | Description                                                                             |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apiKey`           | `KIRORA_API_KEY`                                | Your API key. The constructor throws if there's none.                                   |
| `baseUrl`          | `KIRORA_BASE_URL`, then `https://api.kirora.io` | The host, without `/v1`. For tests and mocks.                                           |
| `timeoutMs`        | `30000`                                         | How long each attempt may take, including reading the response.                         |
| `retry.maxRetries` | `3`                                             | Attempts after the first, from 0 to 10.                                                 |
| `retry.maxDelayMs` | `30000`                                         | The longest single wait between attempts.                                               |
| `fetch`            | `globalThis.fetch`                              | A custom `fetch`, such as a proxy-aware one or a test stub.                             |
| `workspace`        | none                                            | Partner keys only: the tenant to act in. See [Partner workspaces](#partner-workspaces). |
| `appInfo`          | none                                            | Your app's `name` and optional `version`, added to the `User-Agent` header.             |
| `headers`          | none                                            | Headers to send with every request. The SDK's own headers take precedence.              |

### Contacts

```ts
// Create or update a contact, matched by externalId, then email, then phone (at
// least one is required)
const contact = await kirora.contacts.identify({
  externalId: user.id,
  email: user.email,
});

await kirora.contacts.update(contact.id, { firstName: 'Ada' });

// Look one up by Kirora's id, or by `externalId` or `email`
const ada = await kirora.contacts.get('ada@example.com', { idType: 'email' });

// Every contact; see Pagination below
for await (const contact of kirora.contacts.list({ limit: 100 })) {
  console.log(contact.email);
}
```

Contacts also have:

- `identifyBatch()` and `deleteBatch()`, for up to 100 contacts at once
- `delete()`, `merge()` and `export()`, for removing, merging and exporting one contact
- `listTopics()` and `setTopic()`, for a preference centre
- `listInstallations()`, `registerInstallation()` and `deleteInstallation()`, for push
  devices

Each method that takes a contact id also takes `{ idType: 'externalId' }` or
`{ idType: 'email' }`, as `get()` does. That query comes before the call options, so
pass `{}` to skip it: `kirora.contacts.get(contactId, {}, { signal })`.

`listTopics()` resolves with every topic at once, as an array. The other methods named
`list…` return pages (see [Pagination](#pagination)).

### Pagination

Every `list()` (and `listLists()`, `listInstallations()`) can be iterated for every item,
fetching pages as you go, or awaited for one page:

```ts
// Every item. `break` whenever you've had enough; no further pages are fetched.
for await (const contact of kirora.contacts.list({ query: 'ada' })) {
  if (done(contact)) break;
}

// One page, with the total count on the first
const page = await kirora.contacts.list({ query: 'ada' });
console.log(page.meta.count, page.data.length);

// The next page: pass the cursor back with the same filters. It's null on the last page.
const cursor = page.meta.pagination.nextCursor;
if (cursor !== null) {
  const next = await kirora.contacts.list({ query: 'ada', cursor });
}
```

Nothing is fetched until you await or iterate. Awaiting and then iterating the same
`list()` reuses the first page; each iteration fetches the later pages again. See
[Pagination](https://kirora.io/docs/api/reference/pagination) for how cursors work.

### Events

```ts
await kirora.events.track(
  {
    externalId: user.id,
    name: 'Order Completed',
    properties: { total: 49.99, currency: 'GBP' },
  },
  // Optional: see Idempotency below
  { idempotencyKey: `order-${order.id}-completed` },
);
```

`events.trackBatch()` sends up to 100 events at once. One event refused doesn't stop the
rest: the call succeeds, and each entry in `results`, in the order you sent them, has
either the event or an `error`:

```ts
const { results } = await kirora.events.trackBatch({
  events: orders.map((order) => ({
    idempotencyKey: `order-${order.id}-completed`, // stable, so a retry replays it
    event: { externalId: order.userId, name: 'Order Completed' },
  })),
});
results.forEach((result, index) => {
  if ('error' in result) {
    logger.warn('Event not tracked', {
      order: orders[index]!.id,
      code: result.error.code,
    });
  }
});
```

An entry without its own `idempotencyKey` gets one made for it. A `KiroraError` from
`trackBatch()` means the whole batch was refused, such as for an invalid request.
`transactional.sendBatch()` works the same way.

### Transactional messages

```ts
const { messages } = await kirora.transactional.send(
  {
    to: { email: 'customer@example.com' },
    data: { orderId: order.id },
    email: { template: 'order-receipt' },
  },
  // Optional: see Idempotency below
  { idempotencyKey: `receipt-${order.id}` },
);
```

`transactional.cancel(messageId)` cancels a message scheduled with `sendAt`.

### Messages and suppressions

```ts
// What happened to the messages you sent, from any campaign, journey or send
for await (const message of kirora.messages.list({ recipient: 'customer@example.com' })) {
  console.log(message.status);
}
const message = await kirora.messages.get(messageId);

// Addresses Kirora won't send to, such as after a bounce
await kirora.suppressions.add({ emails: ['bounced@example.com'] });
await kirora.suppressions.delete({ emails: ['bounced@example.com'] });
```

### Campaigns

```ts
// First, check what would block a send, without sending
const eligibility = await kirora.campaigns.eligibility(campaignId);

// Then either send it now...
await kirora.campaigns.send(campaignId);

// ...or schedule it instead, here for an hour from now
await kirora.campaigns.schedule(campaignId, {
  type: 'fixed',
  sendAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});
```

A campaign is only ever sent once, so `send()` and `schedule()` are alternatives:
scheduling works on a draft, or reschedules one that hasn't started sending.

`campaigns.trigger(campaignId, body)` sends to the contacts you give it instead of the
saved audience.

### Lists

```ts
const list = await kirora.lists.create({ name: 'VIPs' });
await kirora.lists.addContacts(list.id, { contactIds: [contact.id] });
await kirora.lists.deleteContacts(list.id, { contactIds: [contact.id] });
```

### Checking the key

```ts
const { apiKey, workspace } = await kirora.me();
console.log(apiKey.kind, apiKey.scopes, workspace.name);
```

### Cancellation and per-call options

Every method takes an optional last argument with:

- `signal`, to cancel the call
- `workspace`, to act in for this call only (see [Partner workspaces](#partner-workspaces))
- `timeoutMs` and `maxRetries`, overriding the client's settings for this call
- `headers`, added to the client's `headers` for this call

Methods that create, send or record something also take an `idempotencyKey` (see
[Idempotency](#idempotency)).

```ts
const controller = new AbortController();
for await (const contact of kirora.contacts.list({}, { signal: controller.signal })) {
  // controller.abort() stops the iteration, including a wait before a retry
}
```

A cancelled call rejects with the signal's reason (an `AbortError` by default) and is
never retried.

### Response details

Results carry the HTTP response they came from as `lastResponse`, which is left out of
JSON and spreads:

```ts
const contact = await kirora.contacts.get(contactId);
console.log(contact.lastResponse.requestId); // quote this to Kirora support
contact.lastResponse.rateLimit; // { limit, remaining, resetSeconds }, from RateLimit-*

const sent = await kirora.transactional.send(message, { idempotencyKey });
if (sent.lastResponse.idempotencyReplay) {
  // An earlier request with this key already sent it; this is its stored response
}
```

A page from an awaited `list()` has it too.

## Idempotency

Every call to an endpoint that accepts an idempotency key sends one, such as
`transactional.send()`, `lists.create()` or `contacts.identify()`. The SDK makes the key
for each call and reuses it on every retry, so its own retries never repeat the work: the
API replays the first response instead.

Pass your own `idempotencyKey` to make your retries safe too. Derive it from the
operation (an order id, say) and reuse it only for that same operation and body: the
API refuses a key reused with a different body (`IDEMPOTENCY_KEY_REUSED`), and keeps
keys for a limited time. If a call fails without an answer, retry it with the same key
rather than a new one. See [Idempotency](https://kirora.io/docs/api/reference/idempotency).

## Other endpoints

Endpoints without a resource method can be called through the underlying client, with
the same authentication, retries and errors. The path starts with `/v1`:

```ts
import type { PageMeta } from '@kirora/node';

type Segment = { id: string; name: string };

// request() resolves with the whole JSON body, envelope included
const { data } = await kirora.client.request<{ data: Segment }>(
  'GET',
  `/v1/segments/${segmentId}`,
);

// requestData() unwraps `data`, and list() pages like the resources' lists
const segment = await kirora.client.requestData<Segment>(
  'GET',
  `/v1/segments/${segmentId}`,
);
for await (const s of kirora.client.list<{ data: Segment[]; meta: PageMeta }>(
  '/v1/segments',
)) {
  console.log(s.name);
}
```

These are for JSON endpoints: a 204, a `HEAD` or an empty body resolves with undefined,
and any other body that isn't JSON is a `KiroraResponseError`. The exported `components`
and `operations` types cover only the endpoints with resource methods, so give these your
own result type.

Each endpoint is retried as the API spec says it can be, and gets an idempotency key if
it takes one, just as a resource method would. On an endpoint newer than your version of
the package, a `POST` or `PATCH` is retried after a network error or a 5xx only if you
pass an `idempotencyKey`, or `repeatable: true` to say it's safe to repeat.

For a body that isn't JSON or is too large to buffer, such as a CSV export,
`requestRaw()` resolves with the `Response` without reading its body. It's retried and
throws errors as `request()` does, but `timeoutMs` stops once the headers arrive: read or
pipe the body yourself, and cancel it with the call's `signal`:

```ts
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const response = await kirora.client.requestRaw(
  'GET',
  `/v1/messages/exports/${id}/download`,
);
await pipeline(Readable.fromWeb(response.body!), process.stdout);
```

## Signing users in to the browser SDK

The [web SDK](https://kirora.io/docs/sdks/web) and the mobile SDKs need a
token from your server to know who's signed in. Create one with the SDK token secret from
**Developer → SDK** in the dashboard:

```ts
import { createUserToken } from '@kirora/node';

app.get('/kirora-token', requireSignedIn, (req, res) => {
  res.send(createUserToken(process.env.KIRORA_SDK_TOKEN_SECRET!, req.user.id));
});
```

Tokens last an hour by default. Pass `{ expiresInSeconds }` to change that: a whole
number from 1 to 86,400 (24 hours). An empty secret or user id, or any other lifetime,
throws rather than signing a token.

## Webhooks

Verify each webhook against the **raw** request body, before parsing it: parsed and
re-serialized JSON won't match the signature. With Express, use `express.raw()` on the
webhook route:

```ts
import express from 'express';
import { verifyWebhook } from '@kirora/node';

const app = express();

app.post('/webhooks/kirora', express.raw({ type: 'application/json' }), (req, res) => {
  const webhook = verifyWebhook(
    process.env.KIRORA_WEBHOOK_SECRET!,
    req.body, // a Buffer, thanks to express.raw()
    req.headers,
  );
  if (!webhook) {
    return res.status(401).end();
  }
  const { eventId, eventType } = webhook.payload; // deduplicate on eventId
  // ...
  res.status(200).end();
});
```

With a fetch-style handler, such as a Next.js route, read the body with `text()`:

```ts
import { verifyWebhook } from '@kirora/node';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhook = verifyWebhook(
    process.env.KIRORA_WEBHOOK_SECRET!,
    rawBody,
    request.headers,
  );
  if (!webhook) {
    return new Response(null, { status: 401 });
  }
  const event = webhook.payload;
  // ...
  return new Response(null, { status: 200 });
}
```

`verifyWebhook()` returns the webhook's headers and parsed body, or undefined if it
fails. The signature covers only the body and timestamp, so it also checks that the event
and event id headers match the body. If you verify with `verifyWebhookSignature()`
instead, take `eventType` and `eventId` from the verified body, not the headers.

To find out why a webhook failed, use `assertWebhook()` instead. It throws a
`KiroraWebhookVerificationError` whose `reason` is `invalid_timestamp`,
`invalid_headers` (a missing signature, event or event id header, one that doesn't match
the body, or a bad attempt number), `signature_mismatch` (usually the wrong secret, or a
body that was parsed first) or `timestamp_outside_tolerance` (a replay, or your server's
clock is out of sync):

```ts
import { assertWebhook, KiroraWebhookVerificationError } from '@kirora/node';

try {
  const { payload } = assertWebhook(secret, rawBody, req.headers);
} catch (error) {
  if (error instanceof KiroraWebhookVerificationError) {
    logger.warn('Rejected a webhook', { reason: error.reason });
    return res.status(401).end();
  }
  throw error;
}
```

Webhooks are delivered at least once, so deduplicate on `payload.eventId`. Requests more
than 5 minutes old are rejected as replays; pass `{ toleranceSeconds }` to change that.

## Errors

API errors are thrown as `KiroraError`. Branch on `code`:

```ts
import { KiroraError } from '@kirora/node';

try {
  await kirora.contacts.get(userId, { idType: 'externalId' });
} catch (error) {
  if (error instanceof KiroraError && error.code === 'NOT_FOUND') {
    return null; // never identified
  }
  if (error instanceof KiroraError) {
    logger.error('Kirora request failed', {
      code: error.code,
      requestId: error.requestId,
    });
  }
  throw error;
}
```

Quote `requestId` to Kirora support. Types catch many mistakes before a request is
sent, but in JavaScript, or for rules types can't express (such as a non-empty string),
the API's `VALIDATION_ERROR` is the check.

Every code is listed in [Error codes](https://kirora.io/docs/api/reference/errors), and
exported as `ERROR_CODES`. A code added after your version of the package still comes
through as a string; `error.isKnownCode()` tells you which.

An error response without a code, such as from a proxy, gets one from its status:
`NOT_FOUND` for a 404, say.

`KiroraError` also has `status`, `details`, `requestId`, `retryAfterSeconds` and
`rateLimit`. On `VALIDATION_ERROR` and `DRAFT_INCOMPLETE`, `errors` lists each field the
request got wrong, with a message to show beside it:

```ts
if (error instanceof KiroraError && error.code === 'VALIDATION_ERROR') {
  for (const { field, message } of error.errors) {
    form.setError(field, message);
  }
}
```

Other failures throw other errors:

- `KiroraConnectionError`: no complete response, e.g. a network error, or the
  connection dropped while reading the body.
- `KiroraTimeoutError`: an attempt took longer than `timeoutMs`. A subclass of
  `KiroraConnectionError`.
- `KiroraResponseError`: a success status with a body the SDK can't use, such as HTML
  from a proxy, or a body over 64 MiB. It has `status` and `requestId`.
- `TypeError`: a path the SDK won't send, such as one with an empty id, or an empty
  `workspace`. Nothing is sent.

## Retries

Failed requests are retried with exponential backoff and jitter, respecting
`Retry-After`:

- **Rate limits (429) and connections never made** (the host wasn't found or refused
  the connection) are always retried, since the server did nothing.
- **Network errors and 5xx** are retried only when it can't cause a duplicate: reads,
  requests with an idempotency key, and operations the API says are safe to repeat, such
  as `contacts.identify()` or `lists.update()`. A `contacts.update()` that changes the
  email or `externalId` it looks the contact up by isn't retried.
- **`IDEMPOTENCY_KEY_IN_USE`** is retried, since an earlier request with the same key is
  still running and a retry gets its response.
- **Other 4xx errors** are never retried. A delete retried after an attempt that may have
  done it treats a 404 as success.
- **Cancelled calls** are never retried. If the API answered before you cancelled, the
  call rejects with that answer.

A retry sends the same body and idempotency key as the first attempt, even if you change
the object you passed in meanwhile.

Configure retries and timeouts when creating the client. `timeoutMs` applies to each
attempt, including reading the response, so a call that retries can take longer in
total; use a `signal` such as `AbortSignal.timeout()` for an overall deadline.

```ts
const kirora = new Kirora({
  timeoutMs: 30_000,
  retry: { maxRetries: 3, maxDelayMs: 30_000 },
});
```

## Compatibility

- **Node.js 20.3 or later**, tested on 20, 22 and 24.
- **ES modules and CommonJS:** `import` and `require()` load the same code, so an app
  can mix them: an error from either is an `instanceof KiroraError`.
- **TypeScript:** the types are tested with TypeScript 5.8, under the `NodeNext`,
  `Node16`, `Bundler` and `Node10` module settings, from both ES modules and CommonJS.
- **Versions:** until 1.0, a minor release may include breaking changes, each listed in
  the [changelog](CHANGELOG.md). The SDK targets the API's `/v1`; when the API adds
  fields or error codes, they arrive as type updates in a new release, and older
  releases pass unknown codes and event types through as strings.

## Partner workspaces

With a partner key, act in one of your tenants' workspaces by its `externalId`:

```ts
const tenant = kirora.forWorkspace('tenant-42');
await tenant.contacts.get(contactId);
```

You can also set `workspace` when creating the client, or per call. An empty workspace
throws a `TypeError`, rather than acting in your own workspace. The client copies its
options when created, so changing the object you passed in afterwards has no effect on it
or on its workspace copies.

Manage the workspaces themselves with `kirora.workspaces`: `list()`, `create()`, `get()`,
`update()`, `delete()` (after a grace period, which `cancelDeletion()` can stop),
`suspend()` and `resume()`.

```ts
await kirora.workspaces.create({ name: 'Acme', externalId: 'tenant-42', country: 'GB' });
```

To embed Kirora's segment or email builder in your app, create a session for the tenant
on your server and give its token to the browser. A session lasts 15 minutes.

```ts
const session = await kirora
  .forWorkspace('tenant-42')
  .embedSessions.create({ components: ['email_builder'] });
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
