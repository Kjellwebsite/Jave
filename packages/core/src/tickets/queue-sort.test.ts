import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MINUTE } from '../kernel/clock';
import type { UserActor } from '../permissions/actor';
import type { TestKit } from '../testing';
import { claimTicket } from './assignment.service';
import { listTickets } from './queries.service';
import {
  botContext,
  createTicketKit,
  INTEGRATION_HOOK_TIMEOUT,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
} from './test-fixtures';
import { markThreadCreated } from './thread.service';
import { recordMessage } from './messages.service';

describe('listTickets sort "sla"', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  let staff: UserActor;
  beforeEach(async () => {
    kit = await createTicketKit();
    staff = await kit.member({ roles: ['moderator'], username: 'handler' });
  }, INTEGRATION_HOOK_TIMEOUT);
  afterEach(async () => {
    await kit.close();
  }, INTEGRATION_HOOK_TIMEOUT);

  it('puts unanswered tickets first, soonest deadline first; answered ones follow', async () => {
    const opener = async () => kit.member({ roles: ['verified'] });
    // Answered early: its (old) deadline is the earliest of all, but nothing is due any more.
    const answered = await openAs(kit, await opener(), { priority: 'urgent', subject: 'Answered' });
    const threadId = nextSnowflake();
    await markThreadCreated(botContext(kit), { ticketId: answered.id, threadId });
    await claimTicket(kit.as(staff), { ticketId: answered.id });
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: { discordId: staff.discordId, username: 'handler' },
      body: 'On it.',
    });
    kit.clock.advance(MINUTE);
    const low = await openAs(kit, await opener(), { priority: 'low', subject: 'Low, unanswered' });
    const high = await openAs(kit, await opener(), { priority: 'high', subject: 'High, unanswered' });

    const page = await listTickets(kit.as(staff), { sort: 'sla' });
    expect(page.items.map((item) => item.id)).toEqual([high.id, low.id, answered.id]);
  });
});
