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

/** A campaign, with its content and audience. */
export type Campaign = Schemas['Campaign'];
/** A campaign as `campaigns.list()` returns it, without its content. */
export type CampaignListItem = Schemas['CampaignListItem'];
/**
 * What would stop a campaign sending, overall and on each channel. `canSend` is true when
 * nothing would.
 */
export type CampaignEligibility = Schemas['CampaignEligibility'];
/** The campaign `campaigns.trigger()` sent, and the recipients that named no contact. */
export type TriggeredCampaign = Schemas['TriggeredCampaign'];

export type CreateCampaignParams = Schemas['CreateCampaignInput'];
export type TriggerCampaignParams = Schemas['TriggerCampaignInput'];
export type ScheduleCampaignParams = Schemas['ScheduleCampaignInput'];

export type CampaignsListQuery = QueryOf<'listCampaigns'>;

export type CampaignsPage = PageOf<'listCampaigns'>;

export class Campaigns extends Resource {
  /** Lists campaigns, newest first. Pass `status` to list only those in that state. */
  list(
    query: CampaignsListQuery = {},
    options: CallOptions = {},
  ): PagePromise<CampaignsPage> {
    return this.page('/v1/campaigns', query, options);
  }

  /** Returns one campaign, with its content and audience. */
  get(campaignId: string, options: CallOptions = {}): Promise<WithResponse<Campaign>> {
    return this.unwrap('GET', path`/v1/campaigns/${campaignId}`, options);
  }

  /**
   * Creates a campaign as a draft. Only `name` is required, so a draft can be saved
   * unfinished; nothing is sent until `send()` or `schedule()`.
   */
  create(
    body: CreateCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrap('POST', '/v1/campaigns', options, { body });
  }

  /**
   * Sends a campaign now. A campaign is sent at most once: sending one that has already
   * gone resolves with it again. An unfinished draft throws a `KiroraError` with code
   * `DRAFT_INCOMPLETE`, listing each missing field in `errors`.
   */
  send(
    campaignId: string,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrap('POST', path`/v1/campaigns/${campaignId}/send`, options);
  }

  /**
   * Sends a draft now, once, to up to 5,000 `recipients` instead of its saved audience,
   * each with their own `data`. Recipients that name no contact come back in `notFound`.
   */
  trigger(
    campaignId: string,
    body: TriggerCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<TriggeredCampaign>> {
    return this.unwrap('POST', path`/v1/campaigns/${campaignId}/trigger`, options, {
      body,
    });
  }

  /**
   * Schedules a draft, or moves a scheduled campaign that hasn't started sending to a new
   * time. Throws a `KiroraError` with code `DRAFT_INCOMPLETE` for an unfinished draft, or
   * `INVALID_SCHEDULE` for a fixed time that has passed.
   */
  schedule(
    campaignId: string,
    body: ScheduleCampaignParams,
    options: IdempotentCallOptions = {},
  ): Promise<WithResponse<Campaign>> {
    return this.unwrap('POST', path`/v1/campaigns/${campaignId}/schedule`, options, {
      body,
    });
  }

  /**
   * Reports what would stop a campaign sending, without sending it. Call it before
   * `send()` to find out what to fix.
   */
  eligibility(
    campaignId: string,
    options: CallOptions = {},
  ): Promise<WithResponse<CampaignEligibility>> {
    return this.unwrap('GET', path`/v1/campaigns/${campaignId}/eligibility`, options);
  }
}
