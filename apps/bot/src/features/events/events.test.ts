import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { auditLogs, eventRsvps, events, jobs, members } from '@jave/database';
import { calendar, HOUR, MINUTE, updateSettings } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { FakeInteractionInit } from '../../testing/fake-interaction';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';

const EVENTS_CHANNEL = '600000000000000001';
/** Discord's "Unknown Channel" error code. */
const UNKNOWN_CHANNEL = 10003;
/** The kit clock starts 2026-03-01T12:00Z; events start four days later. */
const START_INPUT = '2026-03-05 18:00';
const START = new Date('2026-03-05T18:00:00Z');

describe('events feature', () => {
  let bot: BotHarness;
  let staff: Awaited<ReturnType<BotHarness['member']>>;

  beforeEach(async () => {
    bot = await createBotHarness();
    const founder = await bot.member({ roles: ['founder'] });
    await updateSettings(bot.kit.as(founder.actor), 'channels', { events: EVENTS_CHANNEL });
    staff = await bot.member({ roles: ['operations'], username: 'theo' });
  });
  afterEach(async () => {
    await bot.close();
  });

  async function createEvent(
    options: { kind?: string; capacity?: number; title?: string; location?: string } = {},
  ): Promise<string> {
    const kind = options.kind ?? 'meetup';
    const open = await bot.run({
      kind: 'slash',
      name: 'events',
      subcommand: 'create',
      user: staff.user,
      options: { kind, ...(options.capacity ? { capacity: options.capacity } : {}) },
    });
    expect(open.interaction.responses[0]?.type).toBe('modal');
    const submit = await bot.run({
      kind: 'modal',
      name: customId('events', 'create', kind, options.capacity ?? 0),
      user: staff.user,
      modalText: {
        title: options.title ?? 'Build Night',
        description: 'Bring hardware. @everyone',
        start: START_INPUT,
        location: options.location ?? '',
      },
      modalSelect: { duration: ['120'] },
    });
    expect(submit.interaction.lastText()).toContain('EVENT SCHEDULED');
    const [row] = await bot.kit.db.select().from(events).orderBy(desc(events.createdAt)).limit(1);
    return row!.id;
  }

  const eventRow = async (id: string) =>
    (await bot.kit.db.select().from(events).where(eq(events.id, id)))[0]!;

  describe('scheduling and the Discord mirror', () => {
    it('staff schedule through the modal; the scheduled event and announcement follow', async () => {
      const id = await createEvent({ capacity: 20 });
      const row = await eventRow(id);
      expect(row).toMatchObject({ title: 'Build Night', kind: 'meetup', capacity: 20 });
      expect(row.startsAt.toISOString()).toBe(START.toISOString());
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(2 * HOUR);

      const [created] = bot.gateway.callsTo('createScheduledEvent');
      expect(created!.args[0]).toMatchObject({ name: 'Build Night', location: 'JAVELIN' });
      const [sent] = bot.gateway.callsTo('sendMessage');
      expect(sent!.args[0]).toBe(EVENTS_CHANNEL);
      const message = bot.gateway.messages.get(row.announcementMessageId!)!;
      const embed = message.payload.embeds![0]!;
      expect(embed.title).toBe('BUILD NIGHT');
      expect(embed.description).not.toContain('@everyone');
      expect(message.payload.components![0]!.components).toHaveLength(4);
      expect(row.discordScheduledEventId).toBe([...bot.gateway.scheduledEvents.keys()][0]);
    });

    it('interprets the start in the staff member time zone and rejects unreadable input', async () => {
      const bad = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'meetup', 0),
        user: staff.user,
        modalText: { title: 'Build Night', start: 'next friday' },
        modalSelect: { duration: ['120'] },
      });
      expect(bad.interaction.lastText()).toContain('INVALID INPUT');
      expect(bad.interaction.lastText()).toContain('YYYY-MM-DD HH:mm');
      const forgedDuration = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'meetup', 0),
        user: staff.user,
        modalText: { title: 'Build Night', start: START_INPUT },
        modalSelect: { duration: ['99999'] },
      });
      expect(forgedDuration.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(events)).toHaveLength(0);
    });

    it('BREAK: members cannot open the create modal or forge its submission', async () => {
      const member = await bot.member({ roles: ['verified'] });
      const open = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'create',
        user: member.user,
      });
      expect(open.interaction.responses[0]?.type).not.toBe('modal');
      expect(open.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'meetup', 0),
        user: member.user,
        modalText: { title: 'Rogue', start: START_INPUT },
        modalSelect: { duration: ['120'] },
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedKind = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'rave', 0),
        user: staff.user,
        modalText: { title: 'Rogue', start: START_INPUT },
        modalSelect: { duration: ['120'] },
      });
      expect(forgedKind.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(events)).toHaveLength(0);
    });

    it('without an events channel only the scheduled event is created', async () => {
      await updateSettings(bot.kit.system, 'channels', { events: undefined });
      const id = await createEvent();
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
      expect(bot.gateway.callsTo('createScheduledEvent')).toHaveLength(1);
      expect((await eventRow(id)).announcementMessageId).toBeNull();
    });

    it('tells staff where the announcement goes, or that none is posted', async () => {
      const announced = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'meetup', 0),
        user: staff.user,
        modalText: { title: 'Build Night', start: START_INPUT },
        modalSelect: { duration: ['120'] },
      });
      expect(announced.interaction.lastText()).toContain(`<#${EVENTS_CHANNEL}>`);
      await updateSettings(bot.kit.system, 'channels', { events: undefined });
      const silent = await bot.run({
        kind: 'modal',
        name: customId('events', 'create', 'talk', 0),
        user: staff.user,
        modalText: { title: 'Orbital Talk', start: START_INPUT },
        modalSelect: { duration: ['60'] },
      });
      expect(silent.interaction.lastText()).toContain('No events channel is set');
    });

    it('re-posts the announcement when its channel was deleted', async () => {
      const id = await createEvent();
      const before = await eventRow(id);
      const NEW_CHANNEL = '600000000000000002';
      await updateSettings(bot.kit.system, 'channels', { events: NEW_CHANNEL });
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('Unknown Channel', UNKNOWN_CHANNEL, true),
      );
      await calendar.updateEvent(bot.kit.system, { eventId: id, title: 'Build Night II' });
      await bot.drain();
      const after = await eventRow(id);
      expect(after.announcementChannelId).toBe(NEW_CHANNEL);
      expect(after.announcementMessageId).not.toBe(before.announcementMessageId);
      const [, second] = bot.gateway.callsTo('sendMessage');
      expect(second!.args[0]).toBe(NEW_CHANNEL);
      const dead = await bot.kit.db.select().from(jobs).where(eq(jobs.status, 'dead'));
      expect(dead).toHaveLength(0);
    });

    it('a cancellation whose announcement channel is gone still completes', async () => {
      const id = await createEvent();
      const row = await eventRow(id);
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('Unknown Channel', UNKNOWN_CHANNEL, true),
      );
      await calendar.cancelEvent(bot.kit.as(staff.actor), { eventId: id, reason: 'Room lost.' });
      await bot.drain();
      const [cancel] = await bot.kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, calendar.DISCORD_EVENTS_CANCEL_JOB));
      expect(cancel).toMatchObject({ status: 'completed' });
      expect(bot.gateway.scheduledEvents.get(row.discordScheduledEventId!)!.status).toBe(
        'canceled',
      );
    });

    it('mirrors live and completed status, re-posting a deleted announcement', async () => {
      const id = await createEvent();
      const first = await eventRow(id);
      bot.gateway.messages.delete(first.announcementMessageId!);
      bot.kit.clock.set(new Date(START.getTime() - 10 * MINUTE));
      const live = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'live',
        user: staff.user,
        options: { event: id },
      });
      expect(live.interaction.lastText()).toContain('EVENT LIVE');
      const seId = first.discordScheduledEventId!;
      expect(bot.gateway.scheduledEvents.get(seId)!.status).toBe('active');
      const after = await eventRow(id);
      expect(after.announcementMessageId).not.toBe(first.announcementMessageId);
      expect(bot.gateway.messages.has(after.announcementMessageId!)).toBe(true);

      bot.kit.clock.set(new Date(START.getTime() + HOUR));
      await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'complete',
        user: staff.user,
        options: { event: id },
      });
      expect(bot.gateway.scheduledEvents.get(seId)!.status).toBe('completed');
      const panel = bot.gateway.messages.get(after.announcementMessageId!)!.payload;
      expect(panel.embeds![0]!.fields!.find((f) => f.name === 'STATUS')!.value).toBe('COMPLETED');
    });

    it('re-creates an unknown scheduled event and reports it as a replacement', async () => {
      const id = await createEvent();
      const before = await eventRow(id);
      bot.gateway.scheduledEvents.delete(before.discordScheduledEventId!);
      await calendar.updateEvent(bot.kit.system, { eventId: id, title: 'Build Night II' });
      await bot.drain();
      const after = await eventRow(id);
      expect(after.discordScheduledEventId).not.toBe(before.discordScheduledEventId);
      expect(bot.gateway.scheduledEvents.get(after.discordScheduledEventId!)!.name).toBe(
        'Build Night II',
      );
    });

    it('deletes its own duplicate when another run stored first', async () => {
      await updateSettings(bot.kit.system, 'channels', { events: undefined });
      const other = await bot.gateway.createScheduledEvent({
        name: 'other process',
        startAt: START,
        reason: 'test',
      });
      const createScheduledEvent = bot.gateway.createScheduledEvent.bind(bot.gateway);
      bot.gateway.createScheduledEvent = async (spec) => {
        // Another bot process stores its scheduled event while this run creates one.
        await bot.kit.db.update(events).set({ discordScheduledEventId: other });
        return createScheduledEvent(spec);
      };
      const id = await createEvent();
      const row = await eventRow(id);
      expect(row.discordScheduledEventId).toBe(other);
      expect(bot.gateway.callsTo('deleteScheduledEvent')).toHaveLength(1);
      expect(bot.gateway.scheduledEvents.size).toBe(1);
      expect(bot.gateway.scheduledEvents.get(other)!.name).toBe('Build Night');
    });

    it('BREAK: a missing permission dead-letters, but what was created is still recorded', async () => {
      bot.gateway.failures.set(
        'sendMessage',
        new DiscordActionError('Missing Permissions', 50013, true),
      );
      const id = await createEvent();
      const row = await eventRow(id);
      expect(row.discordScheduledEventId).not.toBeNull();
      expect(row.announcementMessageId).toBeNull();
      const [job] = await bot.kit.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.type, calendar.DISCORD_EVENTS_PUBLISH_JOB), eq(jobs.status, 'dead')));
      expect(job?.lastError).toContain('Missing Permissions');
    });

    it('cancels: modal reason, scheduled event canceled, announcement loses its buttons', async () => {
      const id = await createEvent();
      const row = await eventRow(id);
      const open = await bot.run({
        kind: 'button',
        name: customId('events', 'cancel', id),
        user: staff.user,
      });
      expect(open.interaction.responses[0]?.type).toBe('modal');
      const done = await bot.run({
        kind: 'modal',
        name: customId('events', 'cancel', id),
        user: staff.user,
        modalText: { reason: 'Venue flooded.' },
      });
      expect(done.interaction.lastText()).toContain('EVENT CANCELLED');
      expect(bot.gateway.scheduledEvents.get(row.discordScheduledEventId!)!.status).toBe(
        'canceled',
      );
      const panel = bot.gateway.messages.get(row.announcementMessageId!)!.payload;
      expect(panel.components).toEqual([]);
      expect(panel.embeds![0]!.description).toContain('Venue flooded.');
    });

    it('objects created while the event is cancelled are cancelled by the follow-up at once', async () => {
      const sendMessage = bot.gateway.sendMessage.bind(bot.gateway);
      bot.gateway.sendMessage = async (channelId, payload) => {
        // Staff cancel on the dashboard while this run is posting the announcement.
        const [row] = await bot.kit.db.select().from(events).limit(1);
        await calendar.cancelEvent(bot.kit.as(staff.actor), {
          eventId: row!.id,
          reason: 'Room double booked.',
        });
        return sendMessage(channelId, payload);
      };
      const id = await createEvent();
      const row = await eventRow(id);
      expect(row.status).toBe('cancelled');
      // Only the follow-up the callback queued ran: the cancellation's own job is still pending.
      const cancelJobs = await bot.kit.db
        .select({ status: jobs.status, dedupeKey: jobs.dedupeKey })
        .from(jobs)
        .where(eq(jobs.type, calendar.DISCORD_EVENTS_CANCEL_JOB));
      expect(cancelJobs.filter((job) => job.status === 'completed')).toHaveLength(1);
      expect(bot.gateway.scheduledEvents.get(row.discordScheduledEventId!)!.status).toBe(
        'canceled',
      );
      const panel = bot.gateway.messages.get(row.announcementMessageId!)!.payload;
      expect(panel.components).toEqual([]);
      expect(panel.embeds![0]!.description).toContain('Room double booked.');
    });
  });

  describe('members', () => {
    it('lists upcoming events and opens one from the picker', async () => {
      const id = await createEvent();
      const member = await bot.member({ roles: ['verified'] });
      const list = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'list',
        user: member.user,
      });
      expect(list.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(list.interaction.lastText()).toContain('`01` **Build Night**');
      const [rsvpRow, pickerRow] = list.interaction.lastPayload()!.components!;
      expect(rsvpRow!.components.map((c) => ('label' in c ? c.label : ''))).toEqual([
        '01 GOING',
        '01 MAYBE',
        '01 DECLINE',
      ]);
      expect(pickerRow!.components[0]!.type).toBe(3);
      const viewWithoutEvent = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'view',
        user: member.user,
      });
      expect(viewWithoutEvent.interaction.lastPayload()!.components).toHaveLength(2);
      expect(viewWithoutEvent.interaction.lastText()).toContain('`01` **Build Night**');

      const rsvp = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going', 'list'),
        user: member.user,
      });
      expect(rsvp.interaction.responses[0]?.type).toBe('update');
      expect(rsvp.interaction.lastText()).toContain('RSVP RECORDED — GOING — Build Night.');
      expect(rsvp.interaction.lastText()).toContain('YOU: GOING');
      const going = rsvp.interaction.lastPayload()!.components![0]!.components[0]!;
      expect('disabled' in going && going.disabled).toBe(true);
      const forgedOrigin = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'maybe', 'everyone'),
        user: member.user,
      });
      expect(forgedOrigin.interaction.lastText()).toContain('EXPIRED');

      const pick = await bot.run({
        kind: 'select',
        name: customId('events', 'pick', 'view'),
        values: [id],
        user: member.user,
      });
      expect(pick.interaction.responses[0]?.type).toBe('update');
      const card = pick.interaction.lastPayload()!;
      expect(card.embeds![0]!.fields!.find((f) => f.name === 'YOUR RSVP')!.value).toContain(
        'GOING',
      );
      // Members never see staff controls.
      expect(card.components).toHaveLength(1);
    });

    it('RSVPs from the announcement: going, full → waitlist, decline promotes', async () => {
      const id = await createEvent({ capacity: 1 });
      const a = await bot.member({ roles: ['verified'] });
      const b = await bot.member({ roles: ['member'] });
      const going = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going'),
        user: a.user,
      });
      expect(going.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(going.interaction.lastText()).toContain('RSVP · GOING');
      const waitlisted = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going'),
        user: b.user,
      });
      expect(waitlisted.interaction.lastText()).toContain('WAITLIST #1');
      const declined = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'declined', 'card'),
        user: a.user,
      });
      expect(declined.interaction.responses[0]?.type).toBe('update');
      expect(declined.interaction.lastText()).toContain('DECLINED');
      const rows = await bot.kit.db.select().from(eventRsvps).where(eq(eventRsvps.eventId, id));
      expect(rows.find((r) => r.memberId === b.actor.memberId)?.status).toBe('going');

      // The debounced count refresh keeps the public announcement current.
      bot.kit.clock.advance(calendar.ANNOUNCEMENT_REFRESH_WINDOW_MS);
      await bot.drain();
      const row = await eventRow(id);
      const panel = bot.gateway.messages.get(row.announcementMessageId!)!.payload;
      expect(panel.embeds![0]!.fields!.find((f) => f.name === 'CAPACITY')!.value).toContain(
        '1 / 1 going',
      );
    });

    it('checks in with the code staff issue once', async () => {
      const id = await createEvent();
      const member = await bot.member({ roles: ['verified'] });
      bot.kit.clock.set(new Date(START.getTime() - 5 * MINUTE));
      const issued = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'checkin-code',
        user: staff.user,
        options: { event: id },
      });
      expect(issued.interaction.lastPayload()!.ephemeral).toBe(true);
      const code = /```\n([A-Z0-9]{4}-[A-Z0-9]{4})\n```/.exec(issued.interaction.lastText())![1]!;

      const picker = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'checkin',
        user: member.user,
      });
      const select = picker.interaction.lastPayload()!.components![0]!.components[0] as {
        options: { label: string; value: string }[];
      };
      expect(select.options).toEqual([
        expect.objectContaining({ label: 'Build Night', value: id }),
      ]);
      const modal = await bot.run({
        kind: 'select',
        name: customId('events', 'pick', 'checkin'),
        values: [id],
        user: member.user,
      });
      expect(modal.interaction.responses[0]?.type).toBe('modal');
      const wrong = await bot.run({
        kind: 'modal',
        name: customId('events', 'checkin', id),
        user: member.user,
        modalText: { code: 'AAAA-AAAA' },
      });
      expect(wrong.interaction.lastText()).toContain('not valid');
      const right = await bot.run({
        kind: 'modal',
        name: customId('events', 'checkin', id),
        user: member.user,
        modalText: { code: code.toLowerCase() },
      });
      expect(right.interaction.lastText()).toContain('CHECKED IN');
      const [rsvp] = await bot.kit.db
        .select()
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.memberId, member.actor.memberId!)));
      expect(rsvp).toMatchObject({ status: 'going' });
      expect(rsvp!.checkedInAt).not.toBeNull();
    });

    it('shows your own event history; others only to event staff', async () => {
      const id = await createEvent();
      const a = await bot.member({ roles: ['verified'] });
      const b = await bot.member({ roles: ['verified'] });
      await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going'),
        user: a.user,
      });
      const own = await bot.run({
        kind: 'user_context',
        name: 'Event History',
        user: a.user,
        targetUser: a.user,
      });
      expect(own.interaction.lastText()).toContain('Build Night');
      const denied = await bot.run({
        kind: 'user_context',
        name: 'Event History',
        user: b.user,
        targetUser: a.user,
      });
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const asStaff = await bot.run({
        kind: 'user_context',
        name: 'Event History',
        user: staff.user,
        targetUser: a.user,
      });
      expect(asStaff.interaction.lastText()).toContain('GOING');
    });

    it('staff subcommands without an event open a picker whose card holds the controls', async () => {
      const id = await createEvent();
      bot.kit.clock.set(new Date(START.getTime() - 10 * MINUTE));
      const picker = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'live',
        user: staff.user,
      });
      expect(picker.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(picker.interaction.lastText()).toContain('CHOOSE AN EVENT');
      const select = picker.interaction.lastPayload()!.components![0]!.components[0] as {
        custom_id: string;
        options: { value: string }[];
      };
      expect(select.custom_id).toBe(customId('events', 'pick', 'view'));
      expect(select.options.map((option) => option.value)).toEqual([id]);
      const card = await bot.run({
        kind: 'select',
        name: select.custom_id,
        values: [id],
        user: staff.user,
      });
      expect(card.interaction.responses[0]?.type).toBe('update');
      const labels = card.interaction
        .lastPayload()!
        .components!.flatMap((row) => row.components.map((c) => ('label' in c ? c.label : '')));
      expect(labels).toEqual(expect.arrayContaining(['GO LIVE', 'CHECK-IN CODE', 'CANCEL EVENT']));
      // Nothing happened on its own: the picker only navigates.
      expect((await eventRow(id)).status).toBe('scheduled');
    });

    it('autocompletes events by title', async () => {
      await createEvent({ title: 'Rocketry Workshop' });
      await createEvent({ title: 'Build Night' });
      const member = await bot.member();
      const { interaction } = await bot.run({
        kind: 'autocomplete',
        name: 'events',
        user: member.user,
        focused: { name: 'event', value: 'rock' },
      });
      const response = interaction.responses[0];
      const names = response && 'choices' in response ? response.choices.map((c) => c.name) : [];
      expect(names).toHaveLength(1);
      expect(names[0]).toContain('Rocketry Workshop');
    });
  });

  describe('tournaments', () => {
    it('draws teams, generates the bracket and records results to a champion', async () => {
      const id = await createEvent({ kind: 'tournament', title: 'Autumn Cup' });
      const players = await Promise.all(
        [1, 2, 3, 4].map(() => bot.member({ roles: ['verified'] })),
      );
      for (const player of players) {
        await bot.run({
          kind: 'button',
          name: customId('events', 'rsvp', id, 'going'),
          user: player.user,
        });
      }
      const drawn = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'teams',
        user: staff.user,
        options: { event: id, size: 1 },
      });
      expect(drawn.interaction.lastText()).toContain('TEAMS DRAWN — 4 teams, 4 members.');

      const bracket = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'bracket',
        user: staff.user,
        options: { event: id },
      });
      expect(bracket.interaction.lastText()).toContain('No bracket yet');
      const generated = await bot.run({
        kind: 'button',
        name: customId('events', 'generate', id, 'seeded'),
        user: staff.user,
      });
      expect(generated.interaction.responses[0]?.type).toBe('update');
      expect(generated.interaction.lastText()).toContain(
        'BRACKET GENERATED — 2 rounds, 3 matches.',
      );
      expect(generated.interaction.lastText()).toContain('SEMIFINALS');

      for (let round = 0; round < 3; round++) {
        const view = await calendar.getBracket(bot.kit.system, { eventId: id });
        const ready = view.rounds.flatMap((r) => r.matches).find((m) => m.status === 'ready')!;
        const pick = await bot.run({
          kind: 'select',
          name: customId('events', 'report-pick', id),
          values: [ready.id],
          user: staff.user,
        });
        expect(pick.interaction.responses[0]?.type).toBe('modal');
        const reported = await bot.run({
          kind: 'modal',
          name: customId('events', 'report', ready.id),
          user: staff.user,
          modalText: { scoreA: '3', scoreB: '1' },
          modalSelect: { winner: ['score'] },
        });
        expect(reported.interaction.lastText()).toContain('RESULT RECORDED');
      }
      const final = await calendar.getBracket(bot.kit.system, { eventId: id });
      expect(final.state).toBe('completed');
      expect((await eventRow(id)).status).toBe('completed');

      // Members read the finished bracket as a monospace block, without staff controls.
      const member = await bot.member({ roles: ['verified'] });
      const view = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'bracket',
        user: member.user,
        options: { event: id },
      });
      const block = view.interaction.lastPayload()!.embeds![0]!.description!;
      expect(block.startsWith('```')).toBe(true);
      expect(block).toContain('FINAL');
      expect(block).toContain(`CHAMPION  ${final.champion!.name}`);
      expect(view.interaction.lastText()).toContain('BRACKET · CHAMPION');
      const controls = (view.interaction.lastPayload()!.components ?? []).flatMap((row) =>
        row.components.map((component) => ('custom_id' in component ? component.custom_id : '')),
      );
      expect(controls.filter((customIdValue) => customIdValue.startsWith('events:'))).toEqual([]);
    });

    it('BREAK: a tied score needs a winner; forged scores are refused', async () => {
      const id = await createEvent({ kind: 'tournament' });
      for (const _ of [1, 2]) {
        const player = await bot.member({ roles: ['verified'] });
        await bot.run({
          kind: 'button',
          name: customId('events', 'rsvp', id, 'going'),
          user: player.user,
        });
      }
      await calendar.createRandomTeams(
        bot.kit.as(await bot.kit.member({ roles: ['operations'] })),
        {
          eventId: id,
          teamSize: 1,
        },
      );
      await bot.run({
        kind: 'button',
        name: customId('events', 'generate', id, 'random'),
        user: staff.user,
      });
      const match = (await calendar.getBracket(bot.kit.system, { eventId: id })).rounds[0]!
        .matches[0]!;
      const report = (scoreA: string, scoreB: string, winner = 'score') =>
        bot.run({
          kind: 'modal',
          name: customId('events', 'report', match.id),
          user: staff.user,
          modalText: { scoreA, scoreB },
          modalSelect: { winner: [winner] },
        });
      expect((await report('2', '2')).interaction.lastText()).toContain('INVALID INPUT');
      expect((await report('-1', '2')).interaction.lastText()).toContain('whole number');
      expect((await report('2', '2', 'c')).interaction.lastText()).toContain('INVALID INPUT');
      expect((await report('2', '2', 'b')).interaction.lastText()).toContain('RESULT RECORDED');
      expect((await report('5', '0')).interaction.lastText()).toContain('already has a result');
    });
  });

  describe('BREAK: custom ids route, they never authorize', () => {
    it('members pressing staff controls are refused and audited; nothing changes', async () => {
      const id = await createEvent({ kind: 'tournament' });
      const member = await bot.member({ roles: ['verified'] });
      bot.kit.clock.set(new Date(START.getTime() - 5 * MINUTE));
      const attempts: Omit<FakeInteractionInit, 'user'>[] = [
        { kind: 'button', name: customId('events', 'live', id) },
        { kind: 'button', name: customId('events', 'complete', id) },
        { kind: 'button', name: customId('events', 'code', id) },
        { kind: 'button', name: customId('events', 'generate', id, 'seeded') },
        { kind: 'select', name: customId('events', 'draw', id), values: ['2'] },
        {
          kind: 'modal',
          name: customId('events', 'cancel', id),
          modalText: { reason: 'mine now' },
        },
        {
          kind: 'select',
          name: customId('events', 'report-pick', id),
          values: ['11111111-1111-4111-8111-111111111111'],
        },
        {
          kind: 'modal',
          name: customId('events', 'report', '11111111-1111-4111-8111-111111111111'),
          modalText: { scoreA: '9', scoreB: '0' },
          modalSelect: { winner: ['score'] },
        },
      ];
      for (const attempt of attempts) {
        const { interaction } = await bot.run({ ...attempt, user: member.user });
        expect(interaction.lastText(), attempt.name).toContain('ACCESS RESTRICTED');
        expect(interaction.responses[0]?.type, attempt.name).not.toBe('modal');
      }
      const report = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'report',
        user: member.user,
        options: { event: id },
      });
      expect(report.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const cancelModal = await bot.run({
        kind: 'button',
        name: customId('events', 'cancel', id),
        user: member.user,
      });
      expect(cancelModal.interaction.responses[0]?.type).not.toBe('modal');
      const row = await eventRow(id);
      expect(row).toMatchObject({ status: 'scheduled', checkInCodeHash: null });
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'access.denied'));
      expect(denials.length).toBeGreaterThanOrEqual(5);
    });

    it('forged and stale ids expire; unknown events are not found', async () => {
      const member = await bot.member({ roles: ['verified'] });
      const forged = [
        customId('events', 'rsvp', 'not-a-uuid', 'going'),
        customId('events', 'rsvp', '11111111-1111-4111-8111-111111111111', 'vip'),
        customId('events', 'selfdestruct', '11111111-1111-4111-8111-111111111111'),
        'events',
      ];
      for (const name of forged) {
        const { interaction } = await bot.run({ kind: 'button', name, user: member.user });
        expect(interaction.lastText(), name).toContain('EXPIRED');
      }
      const unknown = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', '11111111-1111-4111-8111-111111111111', 'going'),
        user: member.user,
      });
      expect(unknown.interaction.lastText()).toContain('NOT FOUND');
      const typed = await bot.run({
        kind: 'slash',
        name: 'events',
        subcommand: 'view',
        user: member.user,
        options: { event: 'Build Night' },
      });
      expect(typed.interaction.lastText()).toContain('Choose an event from the list');
    });

    it('stale controls on a cancelled event are refused by core', async () => {
      const id = await createEvent();
      const member = await bot.member({ roles: ['verified'] });
      await calendar.cancelEvent(bot.kit.as(staff.actor), { eventId: id, reason: 'Called off.' });
      const rsvp = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going', 'card'),
        user: member.user,
      });
      expect(rsvp.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
      const code = await bot.run({
        kind: 'button',
        name: customId('events', 'code', id),
        user: staff.user,
      });
      expect(code.interaction.lastText()).toContain('already ended');
      const early = await bot.run({
        kind: 'button',
        name: customId('events', 'live', id),
        user: staff.user,
      });
      expect(early.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
      expect(await bot.kit.db.select().from(eventRsvps).where(eq(eventRsvps.eventId, id))).toEqual(
        [],
      );
    });

    it('RSVPs close with the event and restricted members cannot respond', async () => {
      const id = await createEvent();
      const restricted = await bot.member({ roles: ['verified'] });
      await bot.kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, restricted.actor.memberId!));
      const refused = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going'),
        user: restricted.user,
      });
      expect(refused.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const late = await bot.member({ roles: ['verified'] });
      bot.kit.clock.set(new Date(START.getTime() + 3 * HOUR));
      const closed = await bot.run({
        kind: 'button',
        name: customId('events', 'rsvp', id, 'going'),
        user: late.user,
      });
      expect(closed.interaction.lastText()).toMatch(/closed|no longer/i);
    });
  });
});
