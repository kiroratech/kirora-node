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

/** A tenant's workspace under your partner account, named by your own `externalId`. */
export type Workspace = Schemas['Workspace'];

export type CreateWorkspaceParams = Schemas['CreateWorkspaceInput'];
export type UpdateWorkspaceParams = Schemas['UpdateWorkspaceInput'];

export type WorkspacesListQuery = QueryOf<'listWorkspaces'>;

export type WorkspacesPage = PageOf<'listWorkspaces'>;

export class Workspaces extends Resource {
  /** Lists your tenants' workspaces, newest first. Partner keys only. */
  list(
    query: WorkspacesListQuery = {},
    options: CallOptions = {},
  ): PagePromise<WorkspacesPage> {
    return this.page('/v1/workspaces', query, options);
  }

  /**
   * Creates a workspace for one of your tenants; act in it with `kirora.forWorkspace()`.
   * Partner keys only. A repeated `externalId` throws a `KiroraError` with code
   * `ALREADY_EXISTS`.
   */
  create(
    body: CreateWorkspaceParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('POST', '/v1/workspaces', options, { body });
  }

  /** Returns a tenant's workspace. Partner keys only. */
  get(externalId: string, options: CallOptions = {}): Promise<WithResponse<Workspace>> {
    return this.unwrap('GET', path`/v1/workspaces/${externalId}`, options);
  }

  /** Changes a tenant workspace's name, country or timezone. Partner keys only. */
  update(
    externalId: string,
    body: UpdateWorkspaceParams,
    options: CallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('PATCH', path`/v1/workspaces/${externalId}`, options, {
      body,
    });
  }

  /**
   * Deletes a tenant's workspace and everything in it after a grace period, and stops its
   * sends at once. Resolves with the workspace, whose `deletesAt` says when;
   * `cancelDeletion()` stops it before then. Partner keys only.
   */
  delete(
    externalId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('DELETE', path`/v1/workspaces/${externalId}`, options);
  }

  /**
   * Stops every send in a tenant's workspace until `resume()`. Messages already queued are
   * skipped, not held. Partner keys only.
   */
  suspend(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('POST', path`/v1/workspaces/${externalId}/suspend`, options);
  }

  /**
   * Lifts a tenant workspace's suspension. Messages skipped meanwhile aren't sent. Partner
   * keys only.
   */
  resume(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('POST', path`/v1/workspaces/${externalId}/resume`, options);
  }

  /**
   * Cancels a tenant workspace's pending deletion. Messages skipped meanwhile aren't sent.
   * Partner keys only.
   */
  cancelDeletion(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap(
      'POST',
      path`/v1/workspaces/${externalId}/cancel-deletion`,
      options,
    );
  }
}
