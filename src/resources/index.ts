/**
 * One class per API resource, one method per operation. Method names are the
 * `operationId` without the resource, so `listContacts` becomes `contacts.list()`.
 *
 * Every method takes the operation's own arguments (path ids, query, body) followed by
 * an optional `CallOptions`. Single results carry the HTTP response as `lastResponse`,
 * and `list()` returns a `PagePromise`: await it for a page, or iterate over every item.
 */
export * from './campaigns.js';
export * from './contacts.js';
export * from './embed-sessions.js';
export * from './events.js';
export * from './lists.js';
export * from './messages.js';
export * from './suppressions.js';
export * from './transactional.js';
export * from './workspaces.js';
export type { CallOptions, IdempotentCallOptions } from './resource.js';
