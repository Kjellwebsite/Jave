import { describe, expect, it } from 'vitest';
import type { RoleSnapshot } from '../../discord/gateway';
import { screenRoleAdds } from './role-screen';

const role = (id: string, position: number, extra: Partial<RoleSnapshot> = {}): RoleSnapshot => ({
  id,
  name: id,
  position,
  managed: false,
  everyone: false,
  permissions: [],
  ...extra,
});

const PLAIN = '500000000000000001';
const STAFF = '500000000000000060';
const ADMIN = '500000000000000070';
const BOOSTER = '500000000000000555';
const HIGH = '500000000000000080';
const UNLISTED = '500000000000000404';

const roles = [
  role(PLAIN, 10),
  role(STAFF, 20, { permissions: ['KickMembers', 'BanMembers'] }),
  role(ADMIN, 30, { permissions: ['Administrator'] }),
  role(BOOSTER, 5, { managed: true }),
  role(HIGH, 60),
];

describe('screenRoleAdds', () => {
  it('withholds what Discord or JAVE policy would not allow, and says why', () => {
    const screen = screenRoleAdds([PLAIN, STAFF, ADMIN, BOOSTER, HIGH, UNLISTED], {
      desired: ['verified'],
      mapping: { verified: PLAIN, member: STAFF, trial: ADMIN, supporter: BOOSTER, core: HIGH },
      roles,
      botHighestRolePosition: 50,
    });
    expect(screen.allowed).toEqual([PLAIN, UNLISTED]);
    expect(screen.withheld).toEqual([
      { roleId: STAFF, reason: 'elevated' },
      { roleId: ADMIN, reason: 'administrator' },
      { roleId: BOOSTER, reason: 'managed' },
      { roleId: HIGH, reason: 'hierarchy' },
    ]);
  });

  it('lets an elevated role through only via a staff role the member holds', () => {
    const input = {
      mapping: { moderator: STAFF, member: STAFF },
      roles,
      botHighestRolePosition: 50,
    };
    expect(screenRoleAdds([STAFF], { ...input, desired: ['member'] }).allowed).toEqual([]);
    expect(screenRoleAdds([STAFF], { ...input, desired: ['moderator'] }).allowed).toEqual([STAFF]);
    // Administrator never, not even through a founder's own mapping.
    expect(
      screenRoleAdds([ADMIN], { ...input, mapping: { founder: ADMIN }, desired: ['founder'] })
        .withheld,
    ).toEqual([{ roleId: ADMIN, reason: 'administrator' }]);
  });
});
