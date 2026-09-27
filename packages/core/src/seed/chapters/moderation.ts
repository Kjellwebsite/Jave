import { recordGuildJoin } from '../../identity/users.service';
import { DAY } from '../../kernel/clock';
import * as moderation from '../../moderation';
import { castMember, snowflakeAt } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';
import { join } from './people';

/**
 * Safety: an escalation that ends in quarantine (warning → automod event →
 * timeout → quarantine), a staff note, a warning issued to the wrong member
 * and revoked, a staff report about an outside account, and a brand-new
 * account flagged by join screening that nobody has triaged yet.
 */

const SECONDS_PER_HOUR = 3600;
/** The raider's account is created this many days before it joins. */
const RAIDER_ACCOUNT_AGE_DAYS = 2;
/** Snowflake sequence numbers for the fictional channel and message ids. */
const GENERAL_CHANNEL_SEQUENCE = 201;
const SPAM_MESSAGE_SEQUENCES = [301, 302, 303] as const;

async function ben(run: SeedRun) {
  return run.person('ben').userId;
}

export function runModeration(story: Story): void {
  let spamEventId = '';
  let wrongWarning = '';

  story.at(-50, 14, async (run) => {
    const warning = await moderation.warnMember(await run.as('rhea'), {
      targetUserId: run.person('priya').userId,
      reason: 'Posting trial spoilers in a public channel.',
    });
    wrongWarning = warning.id;
  });
  story.at(-50, 16, async (run) => {
    await moderation.revokeCase(await run.as('moderator'), {
      caseId: wrongWarning,
      reason: 'Issued to the wrong member; the spoilers came from an outside account.',
    });
  });

  story.at(-castMember('ben').joinedDaysAgo, 21, (run) => join(run, 'ben'));
  story.at(-8, 13, async (run) => {
    await moderation.warnMember(await run.as('moderator'), {
      targetUserId: await ben(run),
      reason: 'Unsolicited DMs to members promoting a token presale.',
    });
    await moderation.addModNote(await run.as('moderator'), {
      targetUserId: await ben(run),
      reason: 'Claims an S in business with no evidence; three members reported the DMs.',
    });
  });
  story.at(-7, 22, async (run) => {
    const channelId = snowflakeAt(run.time(-150), GENERAL_CHANNEL_SEQUENCE);
    const event = await moderation.recordSecurityEvent(run.systemContext('automod'), {
      targetUserId: await ben(run),
      trigger: 'duplicate_content',
      riskScore: 72,
      signals: [
        { key: 'duplicate_messages', weight: 40, detail: '3 identical messages in 40 s' },
        { key: 'new_member', weight: 20, detail: 'joined 2 days ago' },
        { key: 'external_link', weight: 12, detail: 'presale link' },
      ],
      channelId,
      messageIds: SPAM_MESSAGE_SEQUENCES.map((sequence) => snowflakeAt(run.clock.now(), sequence)),
      excerpt: 'Presale closes tonight. DM me for the whitelist link.',
      actionTaken: 'message_deleted',
      dedupeKey: `automod:seed:${SPAM_MESSAGE_SEQUENCES[0]}`,
    });
    spamEventId = event.id;
  });
  story.at(-7, 22.5, async (run) => {
    await moderation.timeoutMember(await run.as('rhea'), {
      targetUserId: await ben(run),
      reason: 'Repeated presale spam after a warning.',
      durationSeconds: 24 * SECONDS_PER_HOUR,
      // Linking the case marks the security event ACTIONED.
      securityEventId: spamEventId,
    });
  });
  story.at(-3, 10, async (run) => {
    await moderation.quarantineMember(await run.as('moderator'), {
      targetUserId: await ben(run),
      reason: 'Resumed presale DMs after the timeout. Quarantined pending core review.',
    });
  });

  story.at(-5, 19, async (run) => {
    const report = await moderation.recordSecurityEvent(await run.as('rhea'), {
      trigger: 'manual_report',
      riskScore: 40,
      signals: [{ key: 'member_reports', weight: 40, detail: 'Four members forwarded DMs' }],
      excerpt: 'Outside account DMing members fake JAVELIN trial invitations.',
      actionTaken: 'flagged',
    });
    await moderation.reviewSecurityEvent(await run.as('kai'), {
      securityEventId: report.id,
      status: 'acknowledged',
      note: 'Pinned a warning in announcements. Watching for rejoins.',
    });
  });

  story.at(-1, 4, async (run) => {
    const createdAt = new Date(run.clock.now().getTime() - RAIDER_ACCOUNT_AGE_DAYS * DAY);
    const profile = {
      discordId: snowflakeAt(createdAt, 1),
      username: 'free_nitro_drops',
      displayName: 'FREE NITRO',
    };
    await recordGuildJoin(run.systemContext('gateway: member joined'), profile);
    await moderation.screenJoin(run.systemContext('gateway: join screening'), {
      discordUser: profile,
    });
  });
}
