import * as tickets from '../../tickets';
import { markThreadCreated } from '../../tickets/thread.service';
import { type CastKey, castMember, snowflakeAt } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/**
 * Tickets in the states staff work with: closed (with a conversation and an
 * internal note), claimed, waiting on the member, and open and unclaimed.
 *
 * MOCK / DEVELOPMENT ONLY: the private threads never existed. The seed plays
 * the bot's part of the contract — `markThreadCreated` after
 * `discord.tickets.open_thread`, `recordMessage` for what members typed in
 * the thread — with Discord-shaped IDs of the fictional server.
 */

type OpenInput = Parameters<typeof tickets.openTicket>[1];

class TicketDesk {
  private sequence = 0;
  private readonly threads = new Map<string, string>();

  private nextSnowflake(run: SeedRun): string {
    this.sequence += 1;
    return snowflakeAt(run.clock.now(), this.sequence);
  }

  async open(run: SeedRun, opener: CastKey, input: OpenInput): Promise<string> {
    const ticket = await tickets.openTicket(await run.as(opener), input);
    await run.later(1);
    const threadId = this.nextSnowflake(run);
    await markThreadCreated(run.systemContext('bot: ticket thread created'), {
      ticketId: ticket.id,
      threadId,
      cardMessageId: this.nextSnowflake(run),
    });
    this.threads.set(ticket.id, threadId);
    return ticket.id;
  }

  /** A message typed in the ticket thread, as the bot's gateway listener records it. */
  async say(run: SeedRun, ticketId: string, author: CastKey, body: string): Promise<void> {
    await run.later(run.rng.int(3, 50));
    const cast = castMember(author);
    await tickets.recordMessage(run.systemContext('bot: ticket message'), {
      threadId: this.threads.get(ticketId)!,
      discordMessageId: this.nextSnowflake(run),
      author: { discordId: cast.discordId, username: cast.username, displayName: cast.displayName },
      body,
    });
  }
}

export function runTicketDesk(story: Story): void {
  const desk = new TicketDesk();
  const ids = new Map<string, string>();

  story.at(-60, 15, async (run) => {
    const id = await desk.open(run, 'aiko', {
      category: 'technical',
      subject: 'Profile shows the wrong primary domain',
      body: 'My profile lists CREATE as my primary domain. It should be BODY.',
    });
    ids.set('aiko', id);
    await tickets.claimTicket(await run.as('rhea'), { ticketId: id });
    await desk.say(run, id, 'rhea', 'Primary domain is yours to set: Profile, then Edit.');
    await desk.say(run, id, 'aiko', 'Found it. Fixed, thank you.');
    await tickets.closeTicket(await run.as('rhea'), {
      ticketId: id,
      reason: 'Resolved: self-service.',
    });
  });

  story.at(-24, 11, async (run) => {
    const id = await desk.open(run, 'luca', {
      category: 'application',
      subject: 'Feedback on my rejected application',
      body: 'Could I get more detail on why my application was rejected, and what would change the outcome?',
    });
    ids.set('luca', id);
  });
  story.at(-24, 15, async (run) => {
    const id = ids.get('luca')!;
    await tickets.claimTicket(await run.as('operations'), { ticketId: id });
    await tickets.addInternalNote(await run.as('operations'), {
      ticketId: id,
      body: 'Reviewer notes: claims of an A in business, no shipped product. Encourage a reapplication after the beta ships.',
    });
    await desk.say(
      run,
      id,
      'operations',
      'Your application claimed more than the evidence showed. Ship the beta, collect real usage, and reapply after the cooldown.',
    );
    await desk.say(run, id, 'luca', 'Understood. What counts as real usage?');
    await desk.say(
      run,
      id,
      'operations',
      'People who are not your friends using it more than once. Numbers beat adjectives.',
    );
  });
  story.at(-23, 10, async (run) => {
    await tickets.closeTicket(await run.as('operations'), {
      ticketId: ids.get('luca')!,
      reason: 'Feedback delivered.',
    });
  });

  story.at(-4, 13, async (run) => {
    const id = await desk.open(run, 'omar', {
      category: 'application',
      subject: 'Interview availability',
      body: 'If an interview comes up, I cannot do weekday mornings (dispatch shifts).',
    });
    await tickets.claimTicket(await run.as('rhea'), { ticketId: id });
    await desk.say(
      run,
      id,
      'rhea',
      'Noted. Which evenings work? Reply with two slots and a time zone.',
    );
    await tickets.setWaiting(await run.as('rhea'), {
      ticketId: id,
      reason: 'Waiting for two evening slots.',
    });
  });

  story.at(-2, 9, async (run) => {
    const id = await desk.open(run, 'priya', {
      category: 'trial',
      priority: 'high',
      subject: 'Trial submission rejects our link',
      body: 'Our team’s evidence link returns an error on submit. The sprint deadline is in three days.',
    });
    await tickets.claimTicket(await run.as('moderator'), { ticketId: id });
    await desk.say(
      run,
      id,
      'moderator',
      'Looking now. Is the link public, and does it start with https://?',
    );
    await desk.say(run, id, 'priya', 'It is a private notes link. Should it be public?');
    await tickets.addInternalNote(await run.as('moderator'), {
      ticketId: id,
      body: 'Links must be reachable by evaluators. Suggest a read-only share link. Not a platform bug.',
    });
  });

  story.at(-1, 16, async (run) => {
    const id = await desk.open(run, 'member', {
      category: 'general',
      subject: 'Can I finish my application while on a mission?',
      body: 'I took the post-mortem mission. Can I still finish and submit my application meanwhile?',
    });
    await desk.say(run, id, 'member', 'Also: does the mission count as evidence?');
  });
}
