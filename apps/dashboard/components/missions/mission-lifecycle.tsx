import { Card, Mono } from '@jave/ui';

const STEPS = [
  { state: 'DRAFT', text: 'Only staff see it. Publish when the brief is final.' },
  {
    state: 'OPEN',
    text: 'Members take it, or staff assign it. Publishing can post the card with ACCEPT in Discord.',
  },
  {
    state: 'SUBMITTED',
    text: 'Work arrives with its evidence. A reviewer outside the unit verifies it or returns it with feedback.',
  },
  {
    state: 'VERIFIED',
    text: 'Evidence on the member’s record for the mission’s capability. A reward achievement follows.',
  },
] as const;

/** How a mission runs, beside the mission form: the consequences of each field in one place. */
export function MissionLifecycle() {
  return (
    <Card className="space-y-4 xl:sticky xl:top-24">
      <p className="type-eyebrow text-fg-subtle">HOW A MISSION RUNS</p>
      <ol className="space-y-4">
        {STEPS.map((step) => (
          <li key={step.state} className="space-y-1">
            <Mono className="text-[12px] text-fg">{step.state}</Mono>
            <p className="text-small text-fg-subtle">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="border-t border-line-subtle pt-4 text-small text-fg-subtle">
        Closing stops new assignments; work in progress continues until it is due. Archiving is
        final.
      </p>
    </Card>
  );
}
