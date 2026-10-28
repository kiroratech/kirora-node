import type { WithResponse } from '../client.js';
import type { PagePromise } from '../pagination.js';
import {
  Resource,
  path,
  type CallOptions,
  type IdempotentCallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

export type Contact = Schemas['Contact'];
export type ContactDetail = Schemas['ContactDetail'];
export type ContactListMeta = Schemas['ContactListMeta'];
export type ContactListMembership = Schemas['ContactListMembership'];
export type ContactDataExport = Schemas['ContactDataExport'];
export type ContactTopic = Schemas['ContactTopic'];
export type PushInstallation = Schemas['PushInstallation'];
export type IdentifyContactsBatchResult = Schemas['IdentifyContactsBatchResult'];
export type DeleteContactsResult = Schemas['DeleteContactsResult'];

/** The ways to name the contact to identify. The API needs at least one. */
type ContactIdentifier = { externalId: string } | { email: string } | { phone: string };

/** The generated type, but requiring an identifier as the API does. */
export type IdentifyContactParams = Exclude<
  Schemas['IdentifyContactInput'],
  ContactIdentifier
> &
  ContactIdentifier;
export type IdentifyContactsBatchParams = Omit<
  Schemas['IdentifyContactsBatchInput'],
  'contacts'
> & { contacts: IdentifyContactParams[] };
export type UpdateContactParams = Schemas['UpdateContactInput'];
export type DeleteContactsParams = Schemas['DeleteContactsInput'];
export type MergeContactParams = Schemas['MergeContactInput'];
export type SetContactTopicParams = Schemas['SetContactTopicInput'];
export type RegisterPushInstallationParams = Schemas['RegisterPushInstallationInput'];

export type ContactsListQuery = QueryOf<'listContacts'>;
export type GetContactQuery = QueryOf<'getContact'>;
export type UpdateContactQuery = QueryOf<'updateContact'>;
export type ContactListsListQuery = QueryOf<'listContactLists'>;
export type PushInstallationsListQuery = QueryOf<'listPushInstallations'>;
/** How to read a contact id in the path: `{ idType: 'externalId' }` or `'email'`. */
export type ContactIdQuery = QueryOf<'deleteContact'>;

export type ContactsPage = PageOf<'listContacts'>;
export type ContactListsPage = PageOf<'listContactLists'>;
export type PushInstallationsPage = PageOf<'listPushInstallations'>;

export class Contacts extends Resource {
  /** `listContacts`. The first page also has the total `meta.count`. */
  list(
    query: ContactsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<ContactsPage> {
    return this.page('/v1/contacts', query, options);
  }

  /** `getContact`. Pass `{ idType: 'email' }` or `'externalId'` to look it up by those. */
  get(
    contactId: string,
    query: GetContactQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}`, options, {
      query,
    });
  }

  /** `updateContact`. Safe to retry, since applying the same patch twice is a no-op. */
  update(
    contactId: string,
    body: UpdateContactParams,
    query: UpdateContactQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('PATCH', path`/v1/contacts/${contactId}`, options, {
      query,
      body,
      repeatable: true,
    });
  }

  /** `deleteContact`, for good. Safe to retry. */
  delete(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<void> {
    return this.remove(path`/v1/contacts/${contactId}`, options, query);
  }

  /**
   * `identifyContact`. Creates or updates a contact, matched by `externalId`, then
   * `email`, then `phone`. Safe to retry.
   */
  identify(
    body: IdentifyContactParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrapRepeatable('POST', '/v1/contacts/identify', options, { body });
  }

  /** `identifyContactsBatch`. Up to 100 contacts, each identified as by `identify()`. */
  identifyBatch(
    body: IdentifyContactsBatchParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<IdentifyContactsBatchResult>> {
    return this.unwrapRepeatable('POST', '/v1/contacts/batch', options, { body });
  }

  /** `deleteContacts`. Up to 100 contacts, each named by id, `externalId` or `email`. */
  deleteBatch(
    body: DeleteContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeleteContactsResult>> {
    return this.unwrapRepeatable('POST', '/v1/contacts/delete', options, { body });
  }

  /**
   * `mergeContacts`. Merges this contact into `keep` and deletes it. A key is made for
   * this call, so a retry after it succeeded replays the result rather than failing on
   * the contact that's gone.
   */
  merge(
    contactId: string,
    body: MergeContactParams,
    query: ContactIdQuery = {},
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrapIdempotent('POST', path`/v1/contacts/${contactId}/merge`, options, {
      body,
      query,
    });
  }

  /** `getContactExport`: everything stored about the contact, for a data request. */
  export(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDataExport>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}/export`, options, { query });
  }

  /** `listContactLists`: the lists a contact belongs to. */
  listLists(
    contactId: string,
    query: ContactListsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<ContactListsPage> {
    return this.page(path`/v1/contacts/${contactId}/lists`, query, options);
  }

  /** `listContactTopics`: the contact's choice on every topic. */
  listTopics(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactTopic[]>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}/topics`, options, { query });
  }

  /**
   * `setContactTopic`. Joins or leaves a topic, on every channel or per channel; joining
   * needs a consent `statement`. Safe to retry.
   */
  setTopic(
    contactId: string,
    topicId: string,
    body: SetContactTopicParams,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactTopic>> {
    return this.unwrap(
      'PUT',
      path`/v1/contacts/${contactId}/topics/${topicId}`,
      options,
      {
        body,
        query,
      },
    );
  }

  /** `listPushInstallations`: the contact's devices and browsers registered for push. */
  listInstallations(
    contactId: string,
    query: PushInstallationsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<PushInstallationsPage> {
    return this.page(path`/v1/contacts/${contactId}/installations`, query, options);
  }

  /**
   * `registerPushInstallation`. Creates or updates a device or browser by its
   * `externalInstallationId`. Safe to retry.
   */
  registerInstallation(
    contactId: string,
    body: RegisterPushInstallationParams,
    query: ContactIdQuery = {},
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<PushInstallation>> {
    return this.unwrapRepeatable(
      'POST',
      path`/v1/contacts/${contactId}/installations`,
      options,
      { body, query },
    );
  }

  /** `deletePushInstallation`. Safe to retry. */
  deleteInstallation(
    contactId: string,
    externalInstallationId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<void> {
    return this.remove(
      path`/v1/contacts/${contactId}/installations/${externalInstallationId}`,
      options,
      query,
    );
  }
}
