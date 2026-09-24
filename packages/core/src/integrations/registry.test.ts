import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, externalAccounts, integrations, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  DisabledError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  findGithubAccount,
  getExternalAccounts,
  linkGithubAccount,
  setExternalAccountVerification,
  unlinkGithubAccount,
} from './external-accounts.service';
import { receiveWebhook } from './inbound.service';
import {
  createIntegration,
  getIntegration,
  listIntegrations,
  rotateIntegrationSecret,
  updateIntegration,
} from './registry.service';
import { signJave } from './signatures';
import { testEncryptionKey } from './testing/fakes';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from '../projects/testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('integration registry', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let admin: UserActor;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit({ encryptionKey: testEncryptionKey() });
    admin = await kit.member({ roles: ['core'] });
    ops = await kit.member({ roles: ['operations'] });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('returns a generated secret exactly once and stores it encrypted', async () => {
    const created = await createIntegration(kit.as(admin), {
      provider: 'generic',
      name: 'Deploys',
      slug: 'deploys',
    });
    expect(created.signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(created.integration).toMatchObject({
      webhookPath: '/api/webhooks/deploys',
      secretSource: 'generated',
      hasSecret: true,
    });
    expect(JSON.stringify(created.integration)).not.toContain(created.signingSecret);
    const [row] = await kit.db.select().from(integrations);
    expect(row!.secretCiphertext).toMatch(/^v1:/);
    expect(row!.secretCiphertext).not.toContain(created.signingSecret!);
    const listed = await listIntegrations(kit.as(admin));
    expect(JSON.stringify(listed)).not.toContain('secretCiphertext');
    expect(JSON.stringify(listed)).not.toContain(created.signingSecret);
    const audit = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'integration.created'));
    expect(JSON.stringify(audit)).not.toContain(created.signingSecret);
  });

  it('GitHub integrations use the deployment secret and cannot be rotated here', async () => {
    const created = await createIntegration(kit.as(admin), {
      provider: 'github',
      name: 'GitHub',
      slug: 'github',
    });
    expect(created.signingSecret).toBeNull();
    expect(created.integration.secretSource).toBe('environment');
    await expect(
      rotateIntegrationSecret(kit.as(admin), { integrationId: created.integration.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('refuses signed integrations without JAVE_ENCRYPTION_KEY', async () => {
    const keyless = await createTestKit();
    try {
      const founder = await keyless.member({ roles: ['founder'] });
      const attempt = createIntegration(keyless.as(founder), {
        provider: 'sidus',
        name: 'Sidus',
        slug: 'sidus',
      });
      await expect(attempt).rejects.toBeInstanceOf(DisabledError);
      await expect(attempt).rejects.toThrow(/JAVE_ENCRYPTION_KEY/);
      expect(await keyless.db.select().from(integrations)).toHaveLength(0);
    } finally {
      await keyless.close();
    }
  });

  it('rotation invalidates the previous secret immediately', async () => {
    const created = await createIntegration(kit.as(admin), {
      provider: 'generic',
      name: 'Deploys',
      slug: 'deploys',
    });
    const rotated = await rotateIntegrationSecret(kit.as(admin), {
      integrationId: created.integration.id,
    });
    expect(rotated.signingSecret).not.toBe(created.signingSecret);
    const send = (secret: string, delivery: string) => {
      const timestamp = String(Math.floor(kit.clock.now().getTime() / 1000));
      const rawBody = `{"n":"${delivery}"}`;
      return receiveWebhook(kit.as(anonymousActor), {
        slug: 'deploys',
        rawBody,
        headers: {
          'x-jave-timestamp': timestamp,
          'x-jave-signature': signJave(secret, timestamp, rawBody),
          'x-jave-delivery': delivery,
        },
        secrets: {},
      });
    };
    expect((await send(created.signingSecret!, 'a')).status).toBe(401);
    expect((await send(rotated.signingSecret, 'b')).status).toBe(202);
  });

  it('BREAK: only canManageIntegrations holders manage integrations (operations cannot)', async () => {
    await expect(
      createIntegration(kit.as(ops), { provider: 'generic', name: 'X', slug: 'xxx' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listIntegrations(kit.as(ops))).rejects.toBeInstanceOf(ForbiddenError);
    const member = await kit.member();
    await expect(listIntegrations(kit.as(member))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: rejects secrets in config, duplicate slugs and unknown providers', async () => {
    await expect(
      createIntegration(kit.as(admin), {
        provider: 'generic',
        name: 'Leaky',
        slug: 'leaky',
        config: { apiToken: 'hunter2' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await createIntegration(kit.as(admin), { provider: 'generic', name: 'One', slug: 'dup-slug' });
    await expect(
      createIntegration(kit.as(admin), { provider: 'generic', name: 'Two', slug: 'DUP-SLUG' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createIntegration(kit.as(admin), {
        provider: 'slack' as never,
        name: 'Slack',
        slug: 'slack',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updates config with an audit trail', async () => {
    const created = await createIntegration(kit.as(admin), {
      provider: 'generic',
      name: 'Deploys',
      slug: 'deploys',
    });
    const updated = await updateIntegration(kit.as(admin), {
      integrationId: created.integration.id,
      config: { relayChannelId: '123456789012345678' },
    });
    expect(updated.config).toEqual({ relayChannelId: '123456789012345678' });
    expect(
      (await getIntegration(kit.as(admin), { integrationId: created.integration.id })).name,
    ).toBe('Deploys');
  });
});

describe('external accounts', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let member: UserActor;
  let verifier: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    member = await kit.member({ username: 'coder' });
    verifier = await kit.member({ roles: ['operations'], username: 'verifier' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('links a self-declared, unverified GitHub account (normalized)', async () => {
    const view = await linkGithubAccount(kit.as(member), { username: ' @Octo-Cat ' });
    expect(view).toMatchObject({
      username: 'octo-cat',
      verified: false,
      profileUrl: 'https://github.com/octo-cat',
    });
    expect(await getExternalAccounts(kit.as(member), { memberId: member.memberId! })).toHaveLength(
      1,
    );
  });

  it('BREAK: usernames are unique across members and must be valid', async () => {
    await linkGithubAccount(kit.as(member), { username: 'octocat' });
    const other = await kit.member();
    await expect(linkGithubAccount(kit.as(other), { username: 'OctoCat' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    for (const username of ['-bad', 'bad-', 'a--b', 'x'.repeat(40), 'drop table;', '']) {
      await expect(linkGithubAccount(kit.as(other), { username })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it('BREAK: nobody verifies their own linked account', async () => {
    await linkGithubAccount(kit.as(verifier), { username: 'verifier-gh' });
    await expect(
      setExternalAccountVerification(kit.as(verifier), {
        memberId: verifier.memberId!,
        verified: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [blocked] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'external_account.self_verification_blocked'));
    expect(blocked).toMatchObject({ result: 'denied' });
  });

  it('BREAK: members cannot verify accounts or read others’ links', async () => {
    await linkGithubAccount(kit.as(member), { username: 'octocat' });
    const other = await kit.member();
    await expect(
      setExternalAccountVerification(kit.as(other), { memberId: member.memberId!, verified: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getExternalAccounts(kit.as(other), { memberId: member.memberId! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      unlinkGithubAccount(kit.as(other), { memberId: member.memberId! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('staff verify; renaming resets verification; id binding beats login', async () => {
    await linkGithubAccount(kit.as(member), { username: 'octocat' });
    const verified = await setExternalAccountVerification(kit.as(verifier), {
      memberId: member.memberId!,
      verified: true,
      externalId: '583231',
    });
    expect(verified).toMatchObject({ verified: true, externalId: '583231' });
    const [note] = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, member.userId));
    expect(note).toMatchObject({ title: 'GITHUB VERIFIED' });
    expect(await findGithubAccount(kit.system, { login: 'OCTOCAT', id: 583231 })).not.toBeNull();
    expect(await findGithubAccount(kit.system, { login: 'octocat', id: 1 })).toBeNull();

    const renamed = await linkGithubAccount(kit.as(member), { username: 'octocat-2' });
    expect(renamed).toMatchObject({ verified: false, externalId: null });
    await unlinkGithubAccount(kit.as(member), {});
    expect(await kit.db.select().from(externalAccounts)).toHaveLength(0);
    await expect(unlinkGithubAccount(kit.as(member), {})).rejects.toBeInstanceOf(NotFoundError);
  });
});
