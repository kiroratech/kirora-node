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

export type Workspace = Schemas['Workspace'];

export type CreateWorkspaceParams = Schemas['CreateWorkspaceInput'];
export type UpdateWorkspaceParams = Schemas['UpdateWorkspaceInput'];

export type WorkspacesListQuery = QueryOf<'listWorkspaces'>;

export type WorkspacesPage = PageOf<'listWorkspaces'>;

/**
 * Your tenants' workspaces, for partner keys only. Each is named by the `externalId`
 * you give it; act in one with `kirora.forWorkspace(externalId)`.
 */
export class Workspaces extends Resource {
  /** `listWorkspaces` */
  list(
    query: WorkspacesListQuery = {},
    options: CallOptions = {},
  ): PagePromise<WorkspacesPage> {
    return this.page('/v1/workspaces', query, options);
  }

  /** `createWorkspace`. Retries reuse one idempotency key, so they never create two. */
  create(
    body: CreateWorkspaceParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrapIdempotent('POST', '/v1/workspaces', options, { body });
  }

  /** `getWorkspace` */
  get(externalId: string, options: CallOptions = {}): Promise<WithResponse<Workspace>> {
    return this.unwrap('GET', path`/v1/workspaces/${externalId}`, options);
  }

  /** `updateWorkspace`. Safe to retry. */
  update(
    externalId: string,
    body: UpdateWorkspaceParams,
    options: CallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('PATCH', path`/v1/workspaces/${externalId}`, options, {
      body,
      repeatable: true,
    });
  }

  /**
   * `deleteWorkspace`. Schedules the deletion, which `cancelDeletion()` can undo until it
   * happens, and resolves with the workspace in its pending state.
   */
  delete(
    externalId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrap('DELETE', path`/v1/workspaces/${externalId}`, options);
  }

  /**
   * `suspendWorkspace`: stops every send in it until resumed, dropping what's queued.
   * Reading and editing keep working.
   */
  suspend(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrapIdempotent(
      'POST',
      path`/v1/workspaces/${externalId}/suspend`,
      options,
    );
  }

  /** `resumeWorkspace` */
  resume(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrapIdempotent(
      'POST',
      path`/v1/workspaces/${externalId}/resume`,
      options,
    );
  }

  /** `cancelWorkspaceDeletion` */
  cancelDeletion(
    externalId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Workspace>> {
    return this.unwrapIdempotent(
      'POST',
      path`/v1/workspaces/${externalId}/cancel-deletion`,
      options,
    );
  }
}
