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

export type Campaign = Schemas['Campaign'];
export type CampaignListItem = Schemas['CampaignListItem'];
export type CampaignEligibility = Schemas['CampaignEligibility'];
export type TriggeredCampaign = Schemas['TriggeredCampaign'];

export type CreateCampaignParams = Schemas['CreateCampaignInput'];
export type TriggerCampaignParams = Schemas['TriggerCampaignInput'];
export type ScheduleCampaignParams = Schemas['ScheduleCampaignInput'];

export type CampaignsListQuery = QueryOf<'listCampaigns'>;

export type CampaignsPage = PageOf<'listCampaigns'>;

export class Campaigns extends Resource {
  /** `listCampaigns` */
  list(
    query: CampaignsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<CampaignsPage> {
    return this.page('/v1/campaigns', query, options);
  }

  /** `getCampaign` */
  get(campaignId: string, options: CallOptions = {}): Promise<WithResponse<Campaign>> {
    return this.unwrap('GET', path`/v1/campaigns/${campaignId}`, options);
  }

  /** `createCampaign`. Retries reuse one idempotency key, so they never create two. */
  create(
    body: CreateCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrapIdempotent('POST', '/v1/campaigns', options, { body });
  }

  /**
   * `sendCampaign`. A campaign is only ever sent once. A key is made for this call, so a
   * retry replays the result rather than failing once the send has started.
   */
  send(
    campaignId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrapIdempotent('POST', path`/v1/campaigns/${campaignId}/send`, options);
  }

  /**
   * `triggerCampaign`. Sends to the given contacts, each with its own `data`, instead of
   * the saved audience.
   */
  trigger(
    campaignId: string,
    body: TriggerCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TriggeredCampaign>> {
    return this.unwrapIdempotent(
      'POST',
      path`/v1/campaigns/${campaignId}/trigger`,
      options,
      { body },
    );
  }

  /**
   * `scheduleCampaign`. `type: 'fixed'` sends at `sendAt` for everyone; `type:
   * 'local_time'` at `localDateTime` on each contact's own clock.
   */
  schedule(
    campaignId: string,
    body: ScheduleCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrapRepeatable(
      'POST',
      path`/v1/campaigns/${campaignId}/schedule`,
      options,
      { body },
    );
  }

  /** `getCampaignEligibility`. Lists anything that would block a send. */
  eligibility(
    campaignId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<CampaignEligibility>> {
    return this.unwrap('GET', path`/v1/campaigns/${campaignId}/eligibility`, options);
  }
}
