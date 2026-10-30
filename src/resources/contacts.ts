import type { WithResponse } from '../core/client.js';
import type { PagePromise } from '../core/pagination.js';
import {
  Resource,
  path,
  type CallOptions,
  type IdempotentCallOptions,
  type PageOf,
  type QueryOf,
  type Schemas,
} from './resource.js';

/** A contact as webhooks carry it. `ContactDetail` adds its email suppression and lists. */
export type Contact = Schemas['Contact'];
/** A contact, with its email suppression and the ids of the lists it's in. */
export type ContactDetail = Schemas['ContactDetail'];
/** The `meta` of a `contacts.list()` page. Its `count` is set on the first page only. */
export type ContactListMeta = Schemas['ContactListMeta'];
/** A list a contact is in, with when they joined it. */
export type ContactListMembership = Schemas['ContactListMembership'];
/** Everything held about one contact, from `contacts.export()`. */
export type ContactDataExport = Schemas['ContactDataExport'];
/** A topic, with whether it reaches the contact. */
export type ContactTopic = Schemas['ContactTopic'];
/** A device or browser registered for push to a contact. */
export type PushInstallation = Schemas['PushInstallation'];
export type IdentifyContactsBatchResult = Schemas['IdentifyContactsBatchResult'];
export type DeleteContactsResult = Schemas['DeleteContactsResult'];

// The generated input is the fields or a bare identifier, so it accepts a body with no
// identifier. This keeps the fields and requires at least one identifier. Remove it once
// codegen types that rule itself.
type ContactIdentifier = { externalId: string } | { email: string } | { phone: string };

/**
 * The body of `contacts.identify()`. At least one of `externalId`, `email` or `phone` is
 * required.
 */
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
/**
 * What a contact id names: Kirora's id (the default), or with `idType` your
 * `externalId` or the contact's email address. It comes before the call options, so pass
 * `{}` to skip it.
 */
export type ContactIdQuery = QueryOf<'deleteContact'>;

export type ContactsPage = PageOf<'listContacts'>;
export type ContactListsPage = PageOf<'listContactLists'>;
export type PushInstallationsPage = PageOf<'listPushInstallations'>;

export class Contacts extends Resource {
  /**
   * Lists contacts, newest first. The first page's `meta.count` counts every match, up to
   * 10,000.
   */
  list(
    query: ContactsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<ContactsPage> {
    return this.page('/v1/contacts', query, options);
  }

  /**
   * Returns one contact, by Kirora's id, or by your `externalId` or email address with
   * `idType`.
   */
  get(
    contactId: string,
    query: GetContactQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}`, options, {
      query,
    });
  }

  /**
   * Updates a contact. Fields left out are unchanged, `attributes` merge key by key, and a
   * key set to `null` is removed. Granting consent needs `consent.statement`. An update
   * that changes the `externalId` or email the contact is looked up by isn't retried after
   * a network error or a 5xx.
   */
  update(
    contactId: string,
    body: UpdateContactParams,
    query: UpdateContactQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('PATCH', path`/v1/contacts/${contactId}`, options, {
      query,
      body,
    });
  }

  /**
   * Deletes a contact and its data, for a right-to-erasure request. It can't be undone.
   * While a message to the contact is being sent, it throws a `KiroraError` with code
   * `CONTACT_SEND_IN_PROGRESS`; retry shortly.
   */
  delete(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<void> {
    return this.remove(path`/v1/contacts/${contactId}`, options, query);
  }

  /**
   * Creates or updates a contact, matched by `externalId`, then `email`, then `phone`.
   * Consent flags left out keep their value, and granting consent needs
   * `consent.statement`. Identifiers that name two different contacts throw a `KiroraError`
   * with code `CONFLICT`.
   */
  identify(
    body: IdentifyContactParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('POST', '/v1/contacts/identify', options, { body });
  }

  /**
   * Identifies up to 100 contacts, each as `identify()` would. One refused doesn't stop the
   * rest: each entry of `results`, in the order sent, has the contact or an `error`.
   */
  identifyBatch(
    body: IdentifyContactsBatchParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<IdentifyContactsBatchResult>> {
    return this.unwrap('POST', '/v1/contacts/batch', options, { body });
  }

  /**
   * Deletes up to 100 contacts, each as `delete()` would, with an `outcome` for each. Retry
   * those that are `send_in_progress` shortly.
   */
  deleteBatch(
    body: DeleteContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeleteContactsResult>> {
    return this.unwrap('POST', '/v1/contacts/delete', options, { body });
  }

  /**
   * Merges this contact, a duplicate, into the one `keep` names, then deletes it. Resolves
   * with the kept contact. It can't be undone.
   */
  merge(
    contactId: string,
    body: MergeContactParams,
    query: ContactIdQuery = {},
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<ContactDetail>> {
    return this.unwrap('POST', path`/v1/contacts/${contactId}/merge`, options, {
      body,
      query,
    });
  }

  /** Returns everything held about one contact, for a right-of-access request. */
  export(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactDataExport>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}/export`, options, { query });
  }

  /** Lists the lists a contact is in, with when they joined each. */
  listLists(
    contactId: string,
    query: ContactListsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<ContactListsPage> {
    return this.page(path`/v1/contacts/${contactId}/lists`, query, options);
  }

  /**
   * Returns every topic, with whether it reaches this contact. Resolves with them all at
   * once, not a page.
   */
  listTopics(
    contactId: string,
    query: ContactIdQuery = {},
    options: CallOptions = {},
  ): Promise<WithResponse<ContactTopic[]>> {
    return this.unwrap('GET', path`/v1/contacts/${contactId}/topics`, options, { query });
  }

  /**
   * Joins a contact to a topic or takes them out of it, on every channel or on each one
   * named. Joining needs `statement`, how the contact agreed.
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

  /**
   * Lists the devices and browsers registered for push to a contact, newest first,
   * inactive ones included.
   */
  listInstallations(
    contactId: string,
    query: PushInstallationsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<PushInstallationsPage> {
    return this.page(path`/v1/contacts/${contactId}/installations`, query, options);
  }

  /**
   * Registers a device or browser for push to a contact. Registering the same token again
   * updates the installation.
   */
  registerInstallation(
    contactId: string,
    body: RegisterPushInstallationParams,
    query: ContactIdQuery = {},
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<PushInstallation>> {
    return this.unwrap('POST', path`/v1/contacts/${contactId}/installations`, options, {
      body,
      query,
    });
  }

  /**
   * Stops push to a contact's device, such as on sign-out. The installation is kept,
   * inactive, and registering it again turns it back on.
   */
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
