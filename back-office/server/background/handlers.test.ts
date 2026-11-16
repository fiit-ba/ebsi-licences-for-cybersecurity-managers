import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { backgroundHandlers } from './handlers.ts';
import type { Domains } from '../runtime.ts';
import type { BackgroundTask } from './types.ts';

test('issuer onboarding is a known identifier-only task, attributed to the TI account', async () => {
  const organization = randomUUID();
  const calls: unknown[][] = [];
  const database = {
    async query(sql: string, values: unknown[]) {
      assert.match(sql, /SELECT account_id FROM accredited_organizations/);
      assert.deepEqual(values, [organization]);
      return { rows: [{ account_id: 42 }] };
    },
  } as unknown as Pool;
  const domains = {
    organizations: { onboarding: { onboard: async (...args: unknown[]) => calls.push(args) } },
  } as unknown as Domains;
  const handle = backgroundHandlers(database, domains, undefined as never);

  await handle({ operation: 'onboard-issuer', organizationId: organization });
  assert.deepEqual(calls, [[organization, 42]]);

  // The payload stays identifier-only: the registering account is read, never carried.
  await assert.rejects(
    handle({ operation: 'onboard-issuer', organizationId: organization, actor: 7 } as never),
    /Unexpected background payload/,
  );
  await assert.rejects(
    handle({ operation: 'onboard-issuer', organizationId: 'not-a-uuid' } as BackgroundTask),
    /Invalid background identifier/,
  );
});
