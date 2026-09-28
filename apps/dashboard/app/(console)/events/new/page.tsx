import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@jave/core';
import { buttonStyles, Card, Icon, PageHeader } from '@jave/ui';
import { EMPTY_EVENT_FORM, EventForm } from '@/components/events/event-form';
import { RestrictedPage } from '@/components/restricted-page';
import { requireConsoleContext } from '@/server/context';
import { EVENT_FORM_LIMITS } from '@/server/data/event-form';
import { loadViewer } from '@/server/data/viewer';
import { createEventAction } from '../actions';

export const metadata: Metadata = { title: 'New event' };

export default async function NewEventPage() {
  const { ctx } = await requireConsoleContext();
  if (!can(ctx, 'canManageEvents')) {
    return (
      <RestrictedPage
        eyebrow="OPERATIONS / EVENTS"
        title="New event"
        capability="canManageEvents"
      />
    );
  }
  const viewer = await loadViewer(ctx);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / EVENTS"
        title="New event"
        description="Scheduling posts the Discord announcement with RSVP buttons and creates the Discord event."
        actions={
          <Link href="/events" className={buttonStyles({ variant: 'ghost' })}>
            <Icon icon={ArrowLeft} size="md" />
            All events
          </Link>
        }
      />
      <Card className="max-w-3xl">
        <EventForm
          action={createEventAction}
          limits={EVENT_FORM_LIMITS}
          values={EMPTY_EVENT_FORM}
          submitLabel="Schedule event"
          timeZone={viewer.timeZone}
        />
      </Card>
    </div>
  );
}
