import { readFileSync } from 'node:fs';
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Kirora, PagePromise, WithResponse } from '../src/index.js';
import type { operations } from '../src/models.js';
import type { PageOf, ResponseBody, ResultOf } from '../src/resources/resource.js';

/** Each operation the SDK wraps, and the method that wraps it. */
const methods = {
  listContacts: (kirora) => kirora.contacts.list,
  getContact: (kirora) => kirora.contacts.get,
  updateContact: (kirora) => kirora.contacts.update,
  deleteContact: (kirora) => kirora.contacts.delete,
  identifyContact: (kirora) => kirora.contacts.identify,
  identifyContactsBatch: (kirora) => kirora.contacts.identifyBatch,
  deleteContacts: (kirora) => kirora.contacts.deleteBatch,
  mergeContacts: (kirora) => kirora.contacts.merge,
  getContactExport: (kirora) => kirora.contacts.export,
  listContactLists: (kirora) => kirora.contacts.listLists,
  listContactTopics: (kirora) => kirora.contacts.listTopics,
  setContactTopic: (kirora) => kirora.contacts.setTopic,
  listPushInstallations: (kirora) => kirora.contacts.listInstallations,
  registerPushInstallation: (kirora) => kirora.contacts.registerInstallation,
  deletePushInstallation: (kirora) => kirora.contacts.deleteInstallation,
  trackEvent: (kirora) => kirora.events.track,
  trackEventsBatch: (kirora) => kirora.events.trackBatch,
  listLists: (kirora) => kirora.lists.list,
  getList: (kirora) => kirora.lists.get,
  createList: (kirora) => kirora.lists.create,
  updateList: (kirora) => kirora.lists.update,
  deleteList: (kirora) => kirora.lists.delete,
  addListContacts: (kirora) => kirora.lists.addContacts,
  deleteListContacts: (kirora) => kirora.lists.deleteContacts,
  listCampaigns: (kirora) => kirora.campaigns.list,
  getCampaign: (kirora) => kirora.campaigns.get,
  createCampaign: (kirora) => kirora.campaigns.create,
  sendCampaign: (kirora) => kirora.campaigns.send,
  triggerCampaign: (kirora) => kirora.campaigns.trigger,
  scheduleCampaign: (kirora) => kirora.campaigns.schedule,
  getCampaignEligibility: (kirora) => kirora.campaigns.eligibility,
  sendTransactionalMessage: (kirora) => kirora.transactional.send,
  sendTransactionalMessagesBatch: (kirora) => kirora.transactional.sendBatch,
  cancelScheduledTransactionalMessage: (kirora) => kirora.transactional.cancel,
  listMessages: (kirora) => kirora.messages.list,
  getMessage: (kirora) => kirora.messages.get,
  listSuppressions: (kirora) => kirora.suppressions.list,
  addSuppressions: (kirora) => kirora.suppressions.add,
  deleteSuppressions: (kirora) => kirora.suppressions.delete,
  listWorkspaces: (kirora) => kirora.workspaces.list,
  createWorkspace: (kirora) => kirora.workspaces.create,
  getWorkspace: (kirora) => kirora.workspaces.get,
  updateWorkspace: (kirora) => kirora.workspaces.update,
  deleteWorkspace: (kirora) => kirora.workspaces.delete,
  suspendWorkspace: (kirora) => kirora.workspaces.suspend,
  resumeWorkspace: (kirora) => kirora.workspaces.resume,
  cancelWorkspaceDeletion: (kirora) => kirora.workspaces.cancelDeletion,
  createEmbedSession: (kirora) => kirora.embedSessions.create,
  getMe: (kirora) => kirora.me,
} satisfies { [OperationId in keyof operations]?: (kirora: Kirora) => unknown };

type Methods = typeof methods;

/** What an operation's method should resolve with, from its success response. */
type Expected<OperationId extends keyof operations> = [
  ResponseBody<OperationId>,
] extends [never]
  ? Promise<void>
  : [PageOf<OperationId>] extends [never]
    ? Promise<WithResponse<ResultOf<OperationId>>>
    : PagePromise<PageOf<OperationId>>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The operations whose method doesn't resolve with what the API returns. */
type Mismatched = {
  [OperationId in keyof Methods]: Equal<
    ReturnType<ReturnType<Methods[OperationId]>>,
    Expected<OperationId>
  > extends true
    ? never
    : OperationId;
}[keyof Methods];

describe('the operation contract', () => {
  it('resolves every method with its operation’s success response', () => {
    expectTypeOf<Mismatched>().toBeNever();
  });

  it('wraps exactly the operations codegen generates types for', () => {
    const codegen = readFileSync(
      new URL('../scripts/codegen.mjs', import.meta.url),
      'utf8',
    );
    const list = codegen.match(/const OPERATIONS = \[([^\]]*)\]/)![1]!;
    const generated = [...list.matchAll(/'(\w+)'/g)].map((match) => match[1]);

    expect(Object.keys(methods).sort()).toEqual(generated.sort());
  });
});
