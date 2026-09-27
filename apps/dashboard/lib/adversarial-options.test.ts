import { describe, expect, it } from 'vitest';
import { observationSubjects, observationTriggers } from './adversarial-options';

describe('observation options mirror the adversarial service', () => {
  it('BREAK: only approved triggers can be linked', () => {
    const options = observationTriggers([
      { id: 't-approved', label: 'Urgent request', approvedAt: new Date(0) },
      { id: 't-pending', label: 'Awaiting approval', approvedAt: null },
    ]);
    expect(options).toEqual([{ value: 't-approved', label: 'Urgent request' }]);
  });

  it('BREAK: the operative is never a subject', () => {
    const subjects = observationSubjects(
      [
        { memberId: 'operative', displayName: 'Ada' },
        { memberId: 'teammate', displayName: 'Bram' },
      ],
      'operative',
    );
    expect(subjects).toEqual([{ memberId: 'teammate', displayName: 'Bram' }]);
  });
});
