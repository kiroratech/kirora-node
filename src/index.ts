import { KiroraClient, type ClientOptions } from './client.js';
import {
  Campaigns,
  Contacts,
  EmbedSessions,
  Events,
  Lists,
  Messages,
  Suppressions,
  Transactional,
  Workspaces,
} from './resources/index.js';
import { controls, type CallOptions, type Schemas } from './resources/resource.js';
import type { WithResponse } from './client.js';

export { KiroraClient } from './client.js';
export type {
  ClientOptions,
  RequestOptions,
  ResponseInfo,
  RetryOptions,
  WithResponse,
} from './client.js';
export { PagePromise } from './pagination.js';
export type { Page, PageMeta } from './pagination.js';
export {
  KiroraError,
  KiroraConnectionError,
  KiroraResponseError,
  KiroraTimeoutError,
  KiroraWebhookVerificationError,
} from './errors.js';
export type { ErrorCode, FieldError, WebhookVerificationFailure } from './errors.js';
export { ERROR_CODES } from './error-codes.js';
export {
  assertWebhookSignature,
  verifyWebhookSignature,
  readWebhookHeaders,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
} from './webhooks.js';
export { WEBHOOK_EVENTS } from './webhook-events.js';
export type {
  WebhookEvent,
  WebhookHeaders,
  WebhookVerificationOptions,
} from './webhooks.js';
export { createUserToken } from './user-tokens.js';
export type * from './resources/index.js';
export type { components, operations } from './models.js';

/** The API key making the request, and the workspace it acts in. */
export type ApiCaller = Schemas['ApiCaller'];

/**
 * The Kirora API client.
 *
 * ```ts
 * const kirora = new Kirora(); // reads KIRORA_API_KEY
 *
 * for await (const contact of kirora.contacts.list()) {
 *   console.log(contact.email);
 * }
 * ```
 */
export class Kirora {
  readonly client: KiroraClient;
  readonly contacts: Contacts;
  readonly lists: Lists;
  readonly campaigns: Campaigns;
  readonly transactional: Transactional;
  readonly events: Events;
  readonly messages: Messages;
  readonly suppressions: Suppressions;
  /** Partner keys only. */
  readonly workspaces: Workspaces;
  /** Partner keys only. */
  readonly embedSessions: EmbedSessions;

  /**
   * Takes the client's options, or a `KiroraClient` to share. With none, the API key is
   * read from `KIRORA_API_KEY`.
   */
  constructor(options: ClientOptions | KiroraClient = {}) {
    // KiroraClient copies what it needs, so later changes to `options` don't reach it.
    this.client = options instanceof KiroraClient ? options : new KiroraClient(options);
    this.contacts = new Contacts(this.client);
    this.lists = new Lists(this.client);
    this.campaigns = new Campaigns(this.client);
    this.transactional = new Transactional(this.client);
    this.events = new Events(this.client);
    this.messages = new Messages(this.client);
    this.suppressions = new Suppressions(this.client);
    this.workspaces = new Workspaces(this.client);
    this.embedSessions = new EmbedSessions(this.client);
  }

  /** `getMe`: the API key in use, its scopes and the workspace it acts in. */
  me(options: CallOptions = {}): Promise<WithResponse<ApiCaller>> {
    return this.client.requestData('GET', '/v1/me', controls(options));
  }

  /** A copy of this client that acts in one of your tenants (partner keys only). */
  forWorkspace(externalId: string): Kirora {
    return new Kirora(this.client.withWorkspace(externalId));
  }
}
