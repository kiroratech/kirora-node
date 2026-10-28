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

export type List = Schemas['List'];
export type AddedListContacts = Schemas['AddedListContacts'];
export type DeletedListContacts = Schemas['DeletedListContacts'];

export type CreateListParams = Schemas['CreateListInput'];
export type UpdateListParams = Schemas['UpdateListInput'];
/** Contacts to add to or remove from a list, by `contactIds`, `externalIds` or `emails`. */
export type ListContactsParams = Schemas['ListContactsInput'];

export type ListsListQuery = QueryOf<'listLists'>;

export type ListsPage = PageOf<'listLists'>;

export class Lists extends Resource {
  /** `listLists` */
  list(query: ListsListQuery = {}, options: CallOptions = {}): PagePromise<ListsPage> {
    return this.page('/v1/lists', query, options);
  }

  /** `getList` */
  get(listId: string, options: CallOptions = {}): Promise<WithResponse<List>> {
    return this.unwrap('GET', path`/v1/lists/${listId}`, options);
  }

  /** `createList`. Retries reuse one idempotency key, so they never create two. */
  create(
    body: CreateListParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<List>> {
    return this.unwrapIdempotent('POST', '/v1/lists', options, { body });
  }

  /** `updateList`. Safe to retry. */
  update(
    listId: string,
    body: UpdateListParams,
    options: CallOptions = {},
  ): Promise<WithResponse<List>> {
    return this.unwrap('PATCH', path`/v1/lists/${listId}`, options, {
      body,
      repeatable: true,
    });
  }

  /** `deleteList` */
  delete(listId: string, options: CallOptions = {}): Promise<void> {
    return this.remove(path`/v1/lists/${listId}`, options);
  }

  /**
   * `addListContacts`, by `contactIds`, `externalIds` or `emails`. Existing members are
   * skipped, so it's safe to retry.
   */
  addContacts(
    listId: string,
    body: ListContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<AddedListContacts>> {
    return this.unwrapRepeatable('POST', path`/v1/lists/${listId}/contacts`, options, {
      body,
    });
  }

  /**
   * `deleteListContacts`: removes contacts from the list, not from Kirora. Non-members
   * are skipped, so it's safe to retry.
   */
  deleteContacts(
    listId: string,
    body: ListContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeletedListContacts>> {
    return this.unwrapRepeatable(
      'POST',
      path`/v1/lists/${listId}/contacts/delete`,
      options,
      { body },
    );
  }
}
