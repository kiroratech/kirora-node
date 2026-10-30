import type { WithResponse } from './client.js';
import { KiroraResponseError } from '../errors/errors.js';

/**
 * The `meta` of every page. `nextCursor` is null on the last page; otherwise pass it back
 * as `cursor`, with the same filters, for the next.
 */
export type PageMeta = { pagination: { limit: number; nextCursor: string | null } };

/** One page of a list. Some lists add to its `meta`, as `ContactListMeta` does. */
export type Page<T, Meta extends PageMeta = PageMeta> = {
  data: T[];
  meta: Meta;
};

/**
 * What a `list()` method returns. Await it for the first page, or iterate it with
 * `for await` for every item, fetching later pages as you go. Nothing is fetched until
 * you do either. Awaiting and then iterating reuses the first page; each iteration
 * fetches the later pages again.
 */
export class PagePromise<P extends Page<unknown>>
  implements Promise<WithResponse<P>>, AsyncIterable<P['data'][number]>
{
  readonly [Symbol.toStringTag] = 'PagePromise';
  private first: Promise<WithResponse<P>> | undefined;

  constructor(
    private readonly fetchPage: (cursor: string | undefined) => Promise<WithResponse<P>>,
    private readonly signal?: AbortSignal,
  ) {}

  then<Fulfilled = WithResponse<P>, Rejected = never>(
    onfulfilled?: ((page: WithResponse<P>) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<Fulfilled | Rejected> {
    return this.firstPage().then(onfulfilled, onrejected);
  }

  catch<Rejected = never>(
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<WithResponse<P> | Rejected> {
    return this.firstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<WithResponse<P>> {
    return this.firstPage().finally(onfinally);
  }

  /**
   * Yields every item, page by page. Throws a `KiroraResponseError` if the API returns a
   * cursor it already returned, since the list would never end.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<P['data'][number], void, undefined> {
    let page = await this.firstPage();
    const followed = new Set<string>();
    for (;;) {
      for (const item of page.data as P['data'][number][]) {
        this.signal?.throwIfAborted();
        yield item;
      }
      this.signal?.throwIfAborted();
      const cursor = page.meta.pagination.nextCursor;
      if (cursor === null) return;
      if (followed.has(cursor)) {
        throw new KiroraResponseError({
          message: `Cursor ${cursor} came round again, so the list would never end`,
          status: page.lastResponse.status,
          requestId: page.lastResponse.requestId,
        });
      }
      followed.add(cursor);
      page = await this.fetchPage(cursor);
    }
  }

  private firstPage(): Promise<WithResponse<P>> {
    this.first ??= this.fetchPage(undefined);
    return this.first;
  }
}
