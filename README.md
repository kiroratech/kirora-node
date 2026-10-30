# Kirora Node.js SDK

Manage contacts, track events, and send campaigns and transactional messages from Node.js.
Includes TypeScript types, automatic pagination, retries, and webhook verification.

[Documentation](https://kirora.io/docs/sdks/node) ·
[API reference](https://kirora.io/docs/api/reference) ·
[Changelog](CHANGELOG.md)

**Contents:** [Quickstart](#quickstart) · [Usage](#usage) · [Pagination](#pagination) ·
[Errors](#errors) · [Configuration](#configuration) · [Retries](#retries-and-idempotency) ·
[Webhooks](#verify-webhooks) · [Advanced usage](#advanced-usage)

## Installation

Requires **Node.js 20.3 or later**.

```sh
npm install @kirora/node
# or
pnpm add @kirora/node
# or
yarn add @kirora/node
```

## Quickstart

Create an API key in the Kirora dashboard and keep it on your server.
See [Authentication](https://kirora.io/docs/api/reference/authentication) for details.

Save this as `quickstart.mjs` to create or update a contact in your workspace:

```js
import { Kirora } from '@kirora/node';

const kirora = new Kirora(); // reads KIRORA_API_KEY
const contact = await kirora.contacts.identify({
  externalId: 'example-user-123',
  email: 'ada@example.com',
});

console.log('Contact ID:', contact.id);
```

Run it with your API key:

```sh
KIRORA_API_KEY=your_key node quickstart.mjs
```

The script prints the contact ID. To test your key without creating a contact,
use `kirora.me()`:

```ts
const { workspace } = await kirora.me();
console.log('Connected to:', workspace.name);
```

The `.mjs` extension lets this example use top-level `await`. In CommonJS, import with
`const { Kirora } = require('@kirora/node');` and put awaited calls inside an async
function.

## Usage

The examples below use `kirora` and `contact` from the quickstart.

### Contacts

```ts
await kirora.contacts.update(contact.id, { firstName: 'Ada' });

const ada = await kirora.contacts.get('ada@example.com', { idType: 'email' });
```

Look up contacts by their Kirora ID, or pass `idType: 'email'` or
`idType: 'externalId'` to use your own identifiers.

Contacts also have:

- `identifyBatch()` and `deleteBatch()`, for up to 100 contacts at once
- `delete()`, `merge()` and `export()`, for removing, merging and exporting one contact
- `listTopics()` and `setTopic()`, for a preference centre
- `listInstallations()`, `registerInstallation()` and `deleteInstallation()`, for push
  devices

Each method that takes a contact id also takes `{ idType: 'externalId' }` or
`{ idType: 'email' }`, as `get()` does. That query comes before the call options, so
pass `{}` to skip it: `kirora.contacts.get(contactId, {}, { signal })`.

### Events

Track an event for an existing contact:

```ts
await kirora.events.track(
  {
    externalId: 'example-user-123',
    name: 'Order Completed',
    properties: { total: 49.99, currency: 'GBP' },
  },
  { idempotencyKey: 'order-123-completed' },
);
```

Use a stable event ID for the idempotency key. See [Retries and idempotency](#retries-and-idempotency)
and [batch requests](#batch-requests).

### Transactional messages

Replace `order-receipt` with the alias or ID of an existing Kirora email template
and use a recipient you control.

```ts
const { messages } = await kirora.transactional.send(
  {
    to: { email: 'customer@example.com' },
    data: { orderId: 'order-123' },
    email: { template: 'order-receipt' },
  },
  { idempotencyKey: 'receipt-order-123' },
);
```

Check delivery status with `kirora.messages`. Reuse the idempotency key only for
the same receipt and request body.

`transactional.cancel(messageId)` cancels a message scheduled with `sendAt`.

### Campaigns

Use the ID of an existing campaign as `campaignId`. Check eligibility before sending:

```ts
// First, check what would block a send, without sending
const eligibility = await kirora.campaigns.eligibility(campaignId);
```

Send it now:

```ts
await kirora.campaigns.send(campaignId);
```

Or schedule it instead, here for an hour from now:

```ts
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

Using the contact created in the quickstart:

```ts
const list = await kirora.lists.create({ name: 'VIPs' });
await kirora.lists.addContacts(list.id, { contactIds: [contact.id] });
await kirora.lists.deleteContacts(list.id, { contactIds: [contact.id] });
```

### Messages and suppressions

Use the ID of an existing message as `messageId`.

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

## Pagination

Iterate over a list to fetch pages automatically, or `await` it for one page:

```ts
// Fetch all matching contacts.
for await (const contact of kirora.contacts.list({ query: 'ada' })) {
  console.log(contact.email);
}

// One page, with the total count on the first
const page = await kirora.contacts.list({ query: 'ada' });
console.log(page.meta.count, page.data.length);

// The next page: pass the cursor back with the same filters. It's null on the last page.
const cursor = page.meta.pagination.nextCursor;
if (cursor !== null) {
  const next = await kirora.contacts.list({ query: 'ada', cursor });
  console.log(next.data);
}
```

Requests start when you await or iterate. Use `break` to stop fetching more pages.
Awaiting and then iterating the same `list()` reuses the first page; each iteration
fetches the later pages again. `listTopics()` returns an array instead of pages.
See [API pagination](https://kirora.io/docs/api/reference/pagination) for cursor details.

## Errors

In these application fragments, `userId` is your user's external ID, `logger` is your
application logger, and `form` is your form library.

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

## Configuration

Set client defaults when you create `Kirora`:

```ts
const kirora = new Kirora({
  timeoutMs: 30_000,
  retry: { maxRetries: 3, maxDelayMs: 30_000 },
});
```

| Option             | Default                                         | Description                                                                                         |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apiKey`           | `KIRORA_API_KEY`                                | Your API key. The constructor throws if there's none.                                               |
| `baseUrl`          | `KIRORA_BASE_URL`, then `https://api.kirora.io` | The host, without `/v1`. For tests and mocks.                                                       |
| `timeoutMs`        | `30000`                                         | How long each attempt may take, including reading the response.                                     |
| `retry.maxRetries` | `3`                                             | Attempts after the first, from 0 to 10.                                                             |
| `retry.maxDelayMs` | `30000`                                         | The longest single wait between attempts.                                                           |
| `fetch`            | `globalThis.fetch`                              | A custom `fetch`, such as a proxy-aware one or a test stub.                                         |
| `workspace`        | none                                            | Partner keys only: the tenant to act in. See [Manage tenant workspaces](#manage-tenant-workspaces). |
| `appInfo`          | none                                            | Your app's `name` and optional `version`, added to the `User-Agent` header.                         |
| `headers`          | none                                            | Headers to send with every request. The SDK's own headers take precedence.                          |

### Cancellation and per-call options

Use `retry.maxRetries` on the client and `maxRetries` on an individual call.

Every method takes an optional last argument with:

- `signal`, to cancel the call
- `workspace`, to act in for this call only (see [Manage tenant workspaces](#manage-tenant-workspaces))
- `timeoutMs` and `maxRetries`, overriding the client's settings for this call
- `headers`, added to the client's `headers` for this call

Methods that create, send or record something also take an `idempotencyKey` (see
[Idempotency](#retries-and-idempotency)).

```ts
const controller = new AbortController();
for await (const contact of kirora.contacts.list({}, { signal: controller.signal })) {
  // controller.abort() stops the iteration, including a wait before a retry
}
```

A cancelled call rejects with the signal's reason (an `AbortError` by default) and is
never retried.

## Retries and idempotency

The SDK retries eligible failures up to three times with backoff. For endpoints that
accept idempotency keys, it generates a key and reuses it across its own retries.

Pass your own `idempotencyKey` when your application may retry an operation. Reuse it
only for the same operation and request body, including when a call fails without a
response. Keys expire; see the [API idempotency rules](https://kirora.io/docs/api/reference/idempotency).

`timeoutMs` applies to each attempt. Use `AbortSignal.timeout()` for an overall deadline.

### Retry behavior

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

## Verify webhooks

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
    req.body,
    req.headers,
  );
  if (!webhook) {
    return res.status(401).end();
  }
  // Process webhook.payload; deduplicate on webhook.payload.eventId.
  res.status(200).end();
});
```

Webhooks can arrive more than once; deduplicate on `payload.eventId`. Verification
returns `undefined` on failure and rejects timestamps older than 5 minutes by default.

### Next.js and fetch-style handlers

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

### Verification diagnostics

In the following Express handler fragment, `secret`, `rawBody`, `req`, `res`, and
`logger` come from your application.

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
See the [API webhook reference](https://kirora.io/docs/api/reference/webhooks) for the delivery contract.

## Compatibility

- **Dependencies:** no runtime dependencies.
- **Node.js 20.3 or later**, tested on 20, 22 and 24.
- **ES modules and CommonJS:** `import` and `require()` load the same code, so an app
  can mix them: an error from either is an `instanceof KiroraError`.
- **TypeScript:** the types are tested with TypeScript 5.8, under the `NodeNext`,
  `Node16`, `Bundler` and `Node10` module settings, from both ES modules and CommonJS.
- **Versions:** until 1.0, a minor release may include breaking changes, each listed in
  the [changelog](CHANGELOG.md). The SDK targets the API's `/v1`; when the API adds
  fields or error codes, they arrive as type updates in a new release, and older
  releases pass unknown codes and event types through as strings.

## Advanced usage

These examples use the initialized `kirora` client. Resource IDs, request bodies,
`orders`, and logging helpers come from your application.

### Batch requests

In this example, `orders` is your array of orders with `id` and `userId` fields,
and `logger` is your application logger. Keep each entry's idempotency key stable
when retrying the same event.

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

### Create browser and mobile SDK tokens

The example uses your Express `app` and `requireSignedIn` middleware. The middleware
must authenticate the caller and populate `req.user.id`.

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

### Manage tenant workspaces

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

### Call endpoints without resource methods

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

## Help and contributing

[Report a bug](https://github.com/kiroratech/node-sdk/issues) ·
[Contribute](CONTRIBUTING.md) · [Report a security issue](SECURITY.md)

## License

[MIT](LICENSE)
