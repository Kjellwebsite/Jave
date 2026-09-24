import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getAllSettings } from '@jave/core';
import { Card, cx, PageHeader, RailActiveIntoView } from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { SettingsSectionForm } from '@/components/settings/settings-section-form';
import { SETTINGS_FORM } from '@/lib/settings-form';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { guarded } from '@/server/guard';
import { saveSettingsAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const loaded = await guarded(() => getAllSettings(ctx));
  if (!loaded.ok)
    return <RestrictedPage eyebrow="SYSTEM" title="Settings" capability="canViewSettings" />;
  const requested = firstParam((await searchParams).section);
  const spec =
    SETTINGS_FORM.find((candidate) => candidate.section === requested) ?? SETTINGS_FORM[0]!;
  const readOnly = !can(ctx, 'canManageSettings');
  const values = loaded.value[spec.section] as Record<string, unknown>;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SYSTEM"
        title="Settings"
        description="Server configuration, one section at a time. Every change is validated and audited with a field-level diff. Secrets never live here."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] max-lg:scroll-fade-x max-lg:pr-8 lg:mx-0 lg:flex-col lg:gap-px lg:overflow-visible lg:px-0">
            {SETTINGS_FORM.map((candidate) => {
              const active = candidate.section === spec.section;
              return (
                <li key={candidate.section} className="shrink-0">
                  <Link
                    href={`/settings?section=${candidate.section}`}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex h-8 items-center rounded-md border px-2.5 text-small transition-colors lg:border-transparent',
                      active
                        ? 'border-line-strong bg-surface-raised text-fg'
                        : 'border-line text-fg-subtle hover:bg-surface-raised/60 hover:text-fg',
                    )}
                  >
                    {candidate.title}
                  </Link>
                </li>
              );
            })}
          </ul>
          <RailActiveIntoView activeKey={spec.section} />
        </nav>
        <Card padding="none" className="max-w-3xl">
          <header className="border-b border-line-subtle px-5 py-4 sm:px-6">
            <h2 className="type-heading text-fg">{spec.title}</h2>
            <p className="mt-1 text-small text-fg-subtle">{spec.description}</p>
          </header>
          <div className="px-5 pb-5 sm:px-6">
            <SettingsSectionForm
              key={spec.section}
              section={spec.section}
              values={values}
              readOnly={readOnly}
              action={saveSettingsAction.bind(null, spec.section)}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
