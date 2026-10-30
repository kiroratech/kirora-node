# Changelog

## Unreleased

- Supports Node.js 20.3 and later, including 22 and 24.
- Can be loaded with `require()`: the package now includes a CommonJS build alongside the
  ES modules.
- Sends a `User-Agent` header naming the SDK version and Node.js version, such as
  `kirora-node/0.1.0 node/v22.12.0`.
- An `appInfo` option names your app or integration in the `User-Agent` header, such as
  `kirora-node/0.1.0 node/v22.12.0 acme-sync/2.1.0`.
- **Breaking:** the search filter on `contacts.list()`, `lists.list()`, `campaigns.list()`,
  `messages.list()` and `suppressions.list()` is now `query` instead of `q`, matching the
  API.
- **Breaking:** a campaign's audience is now `listIds` (up to 20 lists) or `allContacts`
  instead of a single `listId`, and `audienceName` names every deleted list it went to.
- Contacts can be added to lists by name when they're identified, with `lists`.
- Retries follow the API spec's rule for each endpoint, including those called through
  `client.request()`, `requestData()` and `list()`:
  - Every call to an endpoint that takes an `Idempotency-Key` sends one, made per call
    and reused on each attempt. That includes `contacts.identify()`,
    `suppressions.add()`, `lists.addContacts()` and others that sent none.
  - A raw `PATCH` or read-only `POST` is retried after a network error or a 5xx, and a
    raw batch gets a key for each entry without one.
  - A caller's key makes a call safe to retry only on an endpoint that takes keys.
- A request whose connection was never made (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`
  and similar) is always retried, as a 429 is.
- `IDEMPOTENCY_KEY_IN_USE` is retryable: `isRetryable` is true for it, and the client
  retries it.
- A retried delete that gets a 404, after an attempt that may have done the delete,
  succeeds. A 503 without the API's `X-Request-Id`, from a load balancer, doesn't count
  as such an attempt.
- An update to a contact isn't retried when it changes the email or `externalId` the
  contact is looked up by, whether through `contacts.update()` or `client.request()`.
- A call cancelled after the API answered rejects with the API's error rather than the
  signal's reason.
- An error response without a code gets one from its status, such as `NOT_FOUND` or
  `FORBIDDEN`, rather than `INTERNAL_ERROR`. An empty code or message is treated as none.
- `lastResponse.rateLimit` and `KiroraError.rateLimit` give the `RateLimit-*` headers
  as `{ limit, remaining, resetSeconds }`.
- A response body larger than 64 MiB is a `KiroraResponseError`.
- `client.request()` resolves an empty success body with undefined.
- `client.requestRaw()` resolves with the unread `Response`, for a body that isn't JSON
  or is too large to buffer, such as a CSV export.
- A path that doesn't start with `/` throws a `TypeError`.
- An empty `apiKey` falls back to `KIRORA_API_KEY`, and spaces and quotes around the key
  are ignored.
- `baseUrl` defaults to the `KIRORA_BASE_URL` environment variable, and the constructor
  throws a `TypeError` if it isn't an absolute URL.
- An empty `workspace`, as an option, a per-call option or `forWorkspace('')`, throws a
  `TypeError` rather than acting in the key's own workspace.
- A `headers` option, on the client and per call, sends extra headers. An
  `Idempotency-Key` set per call counts as the call's own key; set on the client, where
  every call would share it, it throws a `TypeError`. A `Kirora-Workspace` header counts
  as the `workspace` option, so an empty one throws too.
- `verifyWebhook()` and `assertWebhook()` verify a webhook request in one step, returning
  its headers and parsed body, and refuse event and event id headers that don't match
  the signed body: the signature doesn't cover headers, so a replay could change them.
- `assertWebhookHeaders()` reads a webhook's headers and throws a
  `KiroraWebhookVerificationError` saying why they're invalid, with the new reason
  `invalid_headers`.
- Webhook verification compares every signature in the header, so its timing doesn't
  show which one matched.
- `Retry-After` is read only as seconds or one of the three HTTP date formats.
