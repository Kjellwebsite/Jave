import { describe, expect, it } from 'vitest';
import {
  type Client,
  DiscordAPIError,
  GuildScheduledEventStatus,
  RESTJSONErrorCodes,
} from 'discord.js';
import { DiscordJsGateway } from './discord-gateway';
import { DiscordActionError } from './gateway';

const GUILD_ID = '100000000000000999';
const EVENT_ID = '800000000000000001';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const HTTP_BAD_REQUEST = 400;

type EditOptions = { status?: GuildScheduledEventStatus; scheduledStartTime?: Date };

/** Discord refusing a request body, e.g. a past scheduled start (as its REST client throws it). */
function invalidFormBody(): DiscordAPIError {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.InvalidFormBodyOrContentType, message: 'Invalid Form Body' },
    RESTJSONErrorCodes.InvalidFormBodyOrContentType,
    HTTP_BAD_REQUEST,
    'PATCH',
    `/guilds/${GUILD_ID}/scheduled-events/${EVENT_ID}`,
    { body: undefined, files: undefined },
  );
}

/**
 * A guild whose scheduled-event manager behaves like Discord for the calls
 * the gateway makes, including refusing a scheduled start that has passed.
 * `refuseFieldEdits` makes Discord refuse every edit that is not a status change.
 */
function guildWithEvent(
  event: { status: GuildScheduledEventStatus; scheduledStartAt: Date },
  options: { refuseFieldEdits?: boolean } = {},
) {
  const edits: EditOptions[] = [];
  const deleted: string[] = [];
  const guild = {
    scheduledEvents: {
      fetch: async () => ({ ...event }),
      edit: async (_id: string, edit: EditOptions) => {
        edits.push(edit);
        const pastStart =
          edit.scheduledStartTime !== undefined && edit.scheduledStartTime.getTime() <= Date.now();
        if (pastStart || (options.refuseFieldEdits && edit.status === undefined)) {
          throw invalidFormBody();
        }
        if (edit.status !== undefined) event.status = edit.status;
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  return { gateway: new DiscordJsGateway(client, GUILD_ID), event, edits, deleted };
}

const spec = (startAt: Date) => ({
  name: 'Build Night',
  startAt,
  endAt: new Date(startAt.getTime() + 2 * 60 * MINUTE),
  location: 'Lab 3',
});

describe('DiscordJsGateway scheduled events', () => {
  it('BREAK: going live after the start leaves the passed start alone and starts the event', async () => {
    const start = new Date(Date.now() - 5 * MINUTE);
    const discord = guildWithEvent({
      status: GuildScheduledEventStatus.Scheduled,
      scheduledStartAt: start,
    });
    await discord.gateway.editScheduledEvent(
      EVENT_ID,
      { ...spec(start), status: 'active' },
      'sync',
    );
    expect(discord.edits[0]!.scheduledStartTime).toBeUndefined();
    expect(discord.event.status).toBe(GuildScheduledEventStatus.Active);
  });

  it('sends a start that moved ahead', async () => {
    const discord = guildWithEvent({
      status: GuildScheduledEventStatus.Scheduled,
      scheduledStartAt: new Date(Date.now() + DAY),
    });
    const moved = new Date(Date.now() + 2 * DAY);
    await discord.gateway.editScheduledEvent(EVENT_ID, spec(moved), 'sync');
    expect(discord.edits[0]!.scheduledStartTime).toEqual(moved);
  });

  it('BREAK: a refused field edit still applies the status, then reports the refusal', async () => {
    const start = new Date(Date.now() + DAY);
    const discord = guildWithEvent(
      { status: GuildScheduledEventStatus.Scheduled, scheduledStartAt: start },
      { refuseFieldEdits: true },
    );
    const failure = await discord.gateway
      .editScheduledEvent(EVENT_ID, { ...spec(start), status: 'active' }, 'sync')
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(DiscordActionError);
    expect(failure).toMatchObject({
      code: RESTJSONErrorCodes.InvalidFormBodyOrContentType,
      permanent: true,
    });
    expect(discord.event.status).toBe(GuildScheduledEventStatus.Active);
  });

  it('completing an event that never started deletes it instead of starting it', async () => {
    const discord = guildWithEvent({
      status: GuildScheduledEventStatus.Scheduled,
      scheduledStartAt: new Date(Date.now() - DAY),
    });
    await discord.gateway.editScheduledEvent(EVENT_ID, { status: 'completed' }, 'sync');
    expect(discord.deleted).toEqual([EVENT_ID]);
    expect(discord.edits).toEqual([]);
  });

  it('completes an active event', async () => {
    const discord = guildWithEvent({
      status: GuildScheduledEventStatus.Active,
      scheduledStartAt: new Date(Date.now() - DAY),
    });
    const ended = new Date(Date.now() - DAY);
    await discord.gateway.editScheduledEvent(
      EVENT_ID,
      { ...spec(ended), status: 'completed' },
      'sync',
    );
    expect(discord.event.status).toBe(GuildScheduledEventStatus.Completed);
    // Only the status is sent: nothing about a past event for Discord to refuse.
    expect(discord.edits).toEqual([
      expect.objectContaining({ status: GuildScheduledEventStatus.Completed }),
    ]);
    expect(discord.edits[0]).not.toHaveProperty('scheduledEndTime');
    expect(discord.deleted).toEqual([]);
  });
});
