import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ContactDetail,
  ContactListMeta,
  ContactsPage,
  ContactListsPage,
  CampaignsPage,
  ListsPage,
  IdentifyContactParams,
  IdentifyContactsBatchParams,
} from '../index.js';
import type { ResponseBody } from './resource.js';
import {
  client,
  generated,
  header,
  json,
  noContent,
  page,
  sent,
  serverError,
} from '../../test/helpers.js';

describe('contacts', () => {
  it('sends the key as a bearer token and unwraps the data envelope', async () => {
    const { kirora, calls } = client([json({ data: { id: 'c1' } })]);
    const contact = await kirora.contacts.get('c1');

    expect(contact).toEqual({ id: 'c1' });
    expect(calls[0]!.url).toBe('https://api.example.test/v1/contacts/c1');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer kirora_test');
  });

  it('looks a contact up by email', async () => {
    const { kirora, calls } = client([json({ data: { id: 'c1' } })]);

    await kirora.contacts.get('ada@example.test', { idType: 'email' });

    expect(calls[0]!.url).toBe(
      'https://api.example.test/v1/contacts/ada%40example.test?idType=email',
    );
  });

  it('lists a contact’s lists', async () => {
    const { kirora, calls } = client([page([{ id: 'l1' }], 'CUR')]);

    const lists = await kirora.contacts.listLists('c1', { limit: 1 });

    expect(lists.meta.pagination.nextCursor).toBe('CUR');
    expect(calls[0]!.url).toBe('https://api.example.test/v1/contacts/c1/lists?limit=1');
  });
});

describe('contacts, beyond reads', () => {
  it('sends each operation to its endpoint, with the contact id type as a query', async () => {
    const { kirora, calls } = client([
      noContent(),
      json({ data: { results: [] } }),
      json({ data: { results: [] } }),
      json({ data: { id: 'c2' } }),
      json({ data: { contact: {} } }),
      json({ data: [{ topicId: 't1' }] }),
      json({ data: { topicId: 't1' } }),
      page([{ externalInstallationId: 'i1' }]),
      json({ data: { externalInstallationId: 'i1' } }, { status: 201 }),
      noContent(),
    ]);
    const byExternalId = { idType: 'externalId' } as const;
    const installation = {
      pushAppId: 'p1',
      externalInstallationId: 'i1',
      permission: 'granted',
      targetKind: 'fcm_token',
      target: 'tok',
    } as const;

    await expect(kirora.contacts.delete('u1', byExternalId)).resolves.toBeUndefined();
    await kirora.contacts.identifyBatch(
      { contacts: [{ externalId: 'u1' }, { email: 'b@example.test' }] },
      { idempotencyKey: 'sync-1' },
    );
    await kirora.contacts.deleteBatch({ contacts: [{ contactId: 'c1' }] });
    await kirora.contacts.merge('c1', { keep: { contactId: 'c2' } });
    await kirora.contacts.export('u1', byExternalId);
    const topics = await kirora.contacts.listTopics('c1');
    await kirora.contacts.setTopic('c1', 't1', { subscribed: false });
    await kirora.contacts.listInstallations('c1', { limit: 1 });
    await kirora.contacts.registerInstallation('c1', installation);
    await kirora.contacts.deleteInstallation('c1', 'i/1');

    expect(topics).toEqual([{ topicId: 't1' }]);
    expect(topics.lastResponse.status).toBe(200);
    expect(calls.map(sent)).toEqual([
      {
        method: 'DELETE',
        path: '/v1/contacts/u1?idType=externalId',
        body: undefined,
        key: null,
      },
      {
        method: 'POST',
        path: '/v1/contacts/batch',
        body: { contacts: [{ externalId: 'u1' }, { email: 'b@example.test' }] },
        key: 'sync-1',
      },
      {
        method: 'POST',
        path: '/v1/contacts/delete',
        body: { contacts: [{ contactId: 'c1' }] },
        key: generated,
      },
      {
        method: 'POST',
        path: '/v1/contacts/c1/merge',
        body: { keep: { contactId: 'c2' } },
        key: generated,
      },
      {
        method: 'GET',
        path: '/v1/contacts/u1/export?idType=externalId',
        body: undefined,
        key: null,
      },
      { method: 'GET', path: '/v1/contacts/c1/topics', body: undefined, key: null },
      {
        method: 'PUT',
        path: '/v1/contacts/c1/topics/t1',
        body: { subscribed: false },
        key: null,
      },
      {
        method: 'GET',
        path: '/v1/contacts/c1/installations?limit=1',
        body: undefined,
        key: null,
      },
      {
        method: 'POST',
        path: '/v1/contacts/c1/installations',
        body: installation,
        key: generated,
      },
      {
        method: 'DELETE',
        path: '/v1/contacts/c1/installations/i%2F1',
        body: undefined,
        key: null,
      },
    ]);
  });

  it('retries a merge with the same key, so it replays rather than repeats', async () => {
    const { kirora, calls } = client([serverError(), json({ data: { id: 'c2' } })]);

    await kirora.contacts.merge('c1', { keep: { contactId: 'c2' } });

    expect(calls.map((call) => sent(call).key)).toEqual([generated, sent(calls[0]!).key]);
  });

  it('retries the writes that are safe to repeat, with the same key', async () => {
    const { kirora, calls } = client([serverError(), json({ data: { results: [] } })]);

    await kirora.contacts.identifyBatch({ contacts: [{ externalId: 'u1' }] });

    expect(calls.map((call) => sent(call).key)).toEqual([generated, sent(calls[0]!).key]);
  });

  it('retries an update, unless it changes the field the contact is looked up by', async () => {
    const same = client([serverError(), json({ data: { id: 'c1' } })]);
    await same.kirora.contacts.update(
      'A@example.test',
      { email: ' a@example.test' },
      { idType: 'email' },
    );
    expect(same.calls).toHaveLength(2);

    const retried = client([serverError(), json({ data: { id: 'c1' } })]);
    await retried.kirora.contacts.update(
      'a@example.test',
      { firstName: 'Ada' },
      { idType: 'email' },
    );
    expect(retried.calls).toHaveLength(2);

    for (const [query, body] of [
      [{ idType: 'email' }, { email: 'b@example.test' }],
      [{ idType: 'externalId' }, { externalId: 'u2' }],
    ] as const) {
      const { kirora, calls } = client([serverError(), json({ data: { id: 'c1' } })]);
      await expect(kirora.contacts.update('x', body, query)).rejects.toMatchObject({
        status: 500,
      });
      expect(calls).toHaveLength(1);
    }

    // The same through the client, as for an endpoint without a method.
    const raw = client([serverError(), json({ data: { id: 'c1' } })]);
    await expect(
      raw.kirora.client.request('PATCH', '/v1/contacts/old%40example.test', {
        query: { idType: 'email' },
        body: { email: 'new@example.test' },
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(raw.calls).toHaveLength(1);
  });
});

describe('resource types', () => {
  it('require an identifier to identify a contact', () => {
    expectTypeOf<{ externalId: string }>().toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{
      email: string;
      firstName: string;
      externalId: null;
    }>().toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{
      phone: string;
      attributes: { plan: 'pro' };
    }>().toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{}>().not.toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{ email: null }>().not.toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{ firstName: string }>().not.toMatchTypeOf<IdentifyContactParams>();
    expectTypeOf<{
      contacts: [{ externalId: string }];
    }>().toMatchTypeOf<IdentifyContactsBatchParams>();
    expectTypeOf<{ contacts: [{}] }>().not.toMatchTypeOf<IdentifyContactsBatchParams>();
  });

  it('match the generated list responses', () => {
    expectTypeOf<ContactsPage>().toEqualTypeOf<ResponseBody<'listContacts'>>();
    expectTypeOf<ContactListsPage>().toEqualTypeOf<ResponseBody<'listContactLists'>>();
    expectTypeOf<ListsPage>().toEqualTypeOf<ResponseBody<'listLists'>>();
    expectTypeOf<CampaignsPage>().toEqualTypeOf<ResponseBody<'listCampaigns'>>();
  });

  it('expose contact details and count metadata', async () => {
    const { kirora } = client([
      json({
        data: [{ id: 'c1' }],
        meta: { pagination: { limit: 1, nextCursor: null }, count: 1, countExact: true },
      }),
      page([{ id: 'c1' }]),
    ]);

    const contacts = await kirora.contacts.list();
    expectTypeOf(contacts.meta).toEqualTypeOf<ContactListMeta>();
    expectTypeOf(contacts.data[0]!).toEqualTypeOf<ContactDetail>();
    expect(contacts.meta.count).toBe(1);

    for await (const contact of kirora.contacts.list()) {
      expectTypeOf(contact).toEqualTypeOf<ContactDetail>();
      expectTypeOf(contact.listIds).not.toBeAny();
    }
  });
});
