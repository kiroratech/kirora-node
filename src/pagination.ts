import type { WithResponse } from './client.js';
import { KiroraResponseError } from './errors.js';

export type PageMeta = { pagination: { limit: number; nextCursor: string | null } };

export type Page<T, Meta extends PageMeta = PageMeta> = {
  data: T[];
  meta: Meta;
};

/**
 * What every `list()` returns. Await it for the first page, or iterate over it with
 * `for await` to get every item, fetching further pages as you go:
 *
 * ```ts
 * const page = await kirora.contacts.list({ limit: 50 });
 * for await (const contact of kirora.contacts.list()) {}
 * ```
 *
 * Nothing is fetched until you do either. Awaiting and then iterating the same value
 * reuses the first page; each iteration fetches the later pages again. It isn't a native
 * `Promise`, though it can be used as one.
 *
 * Aborting the list's `signal` stops iteration before the next item, even one from a page
 * already fetched, rejecting with the signal's reason.
 */
export class PagePromise<P extends Page<unknown>>
  implements Promise<WithResponse<P>>, AsyncIterable<P['data'][number]>
{
  readonly [Symbol.toStringTag] = 'PagePromise';
  private first: Promise<WithResponse<P>> | undefined;

  /** `fetchPage(undefined)` fetches the first page. */
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

  async *[Symbol.asyncIterator](): AsyncGenerator<P['data'][number], void, undefined> {
    let page = await this.firstPage();
    // Following a cursor already followed, as in A → B → A, would loop forever.
    const followed = new Set<string>();
    for (;;) {
      for (const item of page.data as P['data'][number][]) {
        this.signal?.throwIfAborted();
        yield item;
      }
      this.signal?.throwIfAborted();
      // Stop on a null cursor, not an empty page.
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
