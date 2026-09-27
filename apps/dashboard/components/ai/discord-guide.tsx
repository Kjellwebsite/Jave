import { Mono, Panel } from '@jave/ui';

interface GuideEntry {
  command: string;
  summary: string;
}

/** The Discord side of JAVE AI (apps/bot/src/features/ai), as members meet it. */
const COMMANDS: readonly GuideEntry[] = [
  { command: '/ask', summary: 'A question, with optional pasted context.' },
  { command: '/research', summary: 'Key points, caveats, sources marked unverified.' },
  { command: '/summarize', summary: 'Pasted text, or a link to a message you can read.' },
  { command: '/analyze', summary: 'Claims, evidence, gaps and open questions.' },
  { command: '/brainstorm', summary: 'Concrete ideas, and how to test the strongest.' },
  { command: '/jave ai-usage', summary: 'Your requests today against the limit.' },
];

const AI_MESSAGE_MENUS = ['Ask JAVE', 'Summarize', 'Explain'] as const;
const RESEARCH_MESSAGE_MENU = 'Save to Sidus';
const TASK_MESSAGE_MENU = 'Create Task';

export interface DiscordGuideProps {
  /** canViewMembers: the research library's Save to Sidus. */
  canSaveResearch: boolean;
  /** canManageMissions: Create Task drafts a mission proposal. */
  canDraftTasks: boolean;
}

/** Where members use JAVE AI day to day: Discord. Answers there are private to the asker. */
export function DiscordGuidePanel({ canSaveResearch, canDraftTasks }: DiscordGuideProps) {
  const menus: string[] = [...AI_MESSAGE_MENUS];
  if (canSaveResearch) menus.push(RESEARCH_MESSAGE_MENU);
  if (canDraftTasks) menus.push(TASK_MESSAGE_MENU);
  return (
    <Panel
      title="In Discord"
      description="Answers are private to you, long ones page with PREV / NEXT. Mentions never ping."
    >
      <dl className="divide-y divide-line-subtle">
        {COMMANDS.map((entry) => (
          <div
            key={entry.command}
            className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="shrink-0 sm:w-36">
              <Mono className="text-fg">{entry.command}</Mono>
            </dt>
            <dd className="min-w-0 text-small text-fg-muted">{entry.summary}</dd>
          </div>
        ))}
        <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
          <dt className="shrink-0 text-small text-fg sm:w-36">Right-click → Apps</dt>
          <dd className="min-w-0 text-small text-fg-muted">{menus.join(' · ')}</dd>
        </div>
      </dl>
    </Panel>
  );
}
