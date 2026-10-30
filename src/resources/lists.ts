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

/** A static list of contacts, whose members you add and remove, unlike a segment. */
export type List = Schemas['List'];
export type AddedListContacts = Schemas['AddedListContacts'];
export type DeletedListContacts = Schemas['DeletedListContacts'];

export type CreateListParams = Schemas['CreateListInput'];
export type UpdateListParams = Schemas['UpdateListInput'];
export type ListContactsParams = Schemas['ListContactsInput'];

export type ListsListQuery = QueryOf<'listLists'>;

export type ListsPage = PageOf<'listLists'>;

export class Lists extends Resource {
  /** Lists the workspace's lists. */
  list(query: ListsListQuery = {}, options: CallOptions = {}): PagePromise<ListsPage> {
    return this.page('/v1/lists', query, options);
  }

  /** Returns one list. Read its members with `contacts.list({ listId })`. */
  get(listId: string, options: CallOptions = {}): Promise<WithResponse<List>> {
    return this.unwrap('GET', path`/v1/lists/${listId}`, options);
  }

  /**
   * Creates a list. Names are unique in the workspace, ignoring case: a repeated one throws
   * a `KiroraError` with code `ALREADY_EXISTS`.
   */
  create(
    body: CreateListParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<List>> {
    return this.unwrap('POST', '/v1/lists', options, { body });
  }

  /**
   * Renames a list or changes its description. Change its members with `addContacts()` and
   * `deleteContacts()`.
   */
  update(
    listId: string,
    body: UpdateListParams,
    options: CallOptions = {},
  ): Promise<WithResponse<List>> {
    return this.unwrap('PATCH', path`/v1/lists/${listId}`, options, {
      body,
    });
  }

  /**
   * Deletes a list, keeping its contacts. While a campaign, form, journey or segment uses
   * it, it throws a `KiroraError` with code `IN_USE`, naming them in `details`.
   */
  delete(listId: string, options: CallOptions = {}): Promise<void> {
    return this.remove(path`/v1/lists/${listId}`, options);
  }

  /**
   * Adds up to 500 contacts to a list, skipping those already in it. Identifiers that name
   * no contact come back in `notFound`. Each contact added starts any journey triggered by
   * joining the list.
   */
  addContacts(
    listId: string,
    body: ListContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<AddedListContacts>> {
    return this.unwrap('POST', path`/v1/lists/${listId}/contacts`, options, {
      body,
    });
  }

  /**
   * Takes up to 500 contacts out of a list, keeping the contacts. Identifiers that name no
   * contact come back in `notFound`.
   */
  deleteContacts(
    listId: string,
    body: ListContactsParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<DeletedListContacts>> {
    return this.unwrap('POST', path`/v1/lists/${listId}/contacts/delete`, options, {
      body,
    });
  }
}
