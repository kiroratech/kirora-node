import { KiroraClient, type ClientOptions, type WithResponse } from './core/client.js';
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

/** The API key making a request, and the workspace it acts in. */
export type ApiCaller = Schemas['ApiCaller'];

/**
 * The Kirora API, with a property for each resource. It holds your API key, so keep it on
 * your server. Pass `ClientOptions`, or a `KiroraClient` to share its settings.
 */
export class Kirora {
  /** The underlying client, for endpoints without a resource method. */
  readonly client: KiroraClient;
  /** The people you send to. */
  readonly contacts: Contacts;
  /** Static lists of contacts, whose members you add and remove yourself. */
  readonly lists: Lists;
  /** Messages sent once to an audience, by email, push or both. */
  readonly campaigns: Campaigns;
  /** One-off messages to one recipient, such as receipts, outside campaigns. */
  readonly transactional: Transactional;
  /** What your contacts do, which starts journeys and feeds segments. */
  readonly events: Events;
  /** The log of every message sent, from any campaign, journey or transactional send. */
  readonly messages: Messages;
  /** Email addresses Kirora won't send to, such as after a bounce. */
  readonly suppressions: Suppressions;
  /** Partner keys only: your tenants' workspaces. */
  readonly workspaces: Workspaces;
  /** Partner keys only: sessions for embedding Kirora's builders in your app. */
  readonly embedSessions: EmbedSessions;

  constructor(options: ClientOptions | KiroraClient = {}) {
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

  /**
   * Returns the API key making the request and the workspace it acts in. Any valid key
   * can call it, so it makes a connection test: a revoked, expired or unknown key throws
   * a `KiroraError` with status 401.
   */
  me(options: CallOptions = {}): Promise<WithResponse<ApiCaller>> {
    return this.client.requestData('GET', '/v1/me', controls(options));
  }

  /**
   * Returns a client that acts in the tenant workspace with this `externalId`. Partner
   * keys only.
   */
  forWorkspace(externalId: string): Kirora {
    return new Kirora(this.client.withWorkspace(externalId));
  }
}
