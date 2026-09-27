import { awardAchievement } from '../../achievements';
import { markNotificationsRead } from '../../notifications/notifications.service';
import * as verification from '../../verification';
import type { CastKey } from '../cast';
import type { Story } from '../story';
import { join } from './people';

/**
 * Recognition and the last hours before the anchor: manual achievement
 * awards, skill verifications (one approved, one waiting), inboxes read up
 * to a week ago, and a brand-new arrival who has not onboarded yet.
 */

const INBOX_READERS: readonly CastKey[] = [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'member',
  'kai',
  'theo',
  'rhea',
  'mara',
  'sana',
  'aiko',
  'ilya',
  'noor',
  'leo',
  'jun',
  'elif',
  'mateo',
  'priya',
  'luca',
  'hana',
  'iris',
];

const STAFF_READERS: readonly CastKey[] = ['founder', 'core', 'kai'];

export function recognizeWork(story: Story): void {
  story.at(-99, 12, async (run) => {
    await awardAchievement(await run.as('theo'), {
      memberId: run.person('mara').memberId,
      key: 'team_leader',
      reason: 'Led the Helios team from bench prototype to flight review.',
    });
  });
  story.at(-73, 12, async (run) => {
    await awardAchievement(await run.as('operations'), {
      memberId: run.person('noor').memberId,
      key: 'team_leader',
      reason: 'Kept her 48-Hour Ship unit on schedule; every hand-off documented.',
    });
  });

  let aikoRequest = '';
  story.at(-15, 18, async (run) => {
    const request = await verification.requestVerification(await run.as('aiko'), {
      target: { type: 'skill', facetKey: 'body.physical', requestedRank: 'A' },
      claim: '2k erg 6:58 at national junior trials; selected for the national eight.',
      evidence: [
        {
          title: 'National junior trials: official 2k results',
          url: 'https://results.example.org/rowing/junior-trials',
        },
      ],
    });
    aikoRequest = request.id;
  });
  story.at(-13, 10, async (run) => {
    await verification.startReview(await run.as('core'), { verificationId: aikoRequest });
    await verification.decideVerification(await run.as('core'), {
      verificationId: aikoRequest,
      decision: 'approve',
      note: 'Official results checked with the federation listing.',
    });
  });
  story.at(-4, 20, async (run) => {
    await verification.requestVerification(await run.as('mateo'), {
      target: { type: 'skill', facetKey: 'create.technical', requestedRank: 'B' },
      claim: 'Designed the swerve-drive module six teams now run.',
      evidence: [
        {
          title: 'Swerve module repository and adoption list',
          url: 'https://code.example.org/mateo/swerve-module',
        },
      ],
    });
  });

  story.at(-7, 8, async (run) => {
    for (const key of INBOX_READERS) await markNotificationsRead(await run.as(key), 'all');
  });
  story.at(-2, 8, async (run) => {
    for (const key of STAFF_READERS) await markNotificationsRead(await run.as(key), 'all');
  });
  story.at(-1, 23, (run) => join(run, 'zara'));
}
