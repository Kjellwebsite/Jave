import { StickyNote } from 'lucide-react';
import { EmptyState, Mono } from '@jave/ui';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { AddNoteForm } from './add-note-form';

export interface StaffNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
}

export function StaffNotes({
  memberId,
  notes,
  canAdd,
  addAction,
  timeZone,
}: {
  memberId: string;
  notes: readonly StaffNote[];
  canAdd: boolean;
  addAction: FormAction;
  timeZone: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {notes.length === 0 ? (
          <EmptyState
            icon={StickyNote}
            title="NO NOTES"
            description="Private staff notes about this member appear here."
          />
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg border border-line bg-surface px-5 py-4">
                <p className="whitespace-pre-wrap text-body text-fg-muted">{note.body}</p>
                <p className="mt-2.5 flex flex-wrap gap-x-3 text-small text-fg-subtle">
                  <span>{note.authorName}</span>
                  <Mono dim className="text-[12px]">
                    {formatTimestamp(note.createdAt, timeZone)}
                  </Mono>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canAdd ? (
        <section
          aria-labelledby="add-note-title"
          className="h-fit rounded-lg border border-line bg-surface p-5"
        >
          <h3 id="add-note-title" className="type-heading text-fg">
            Add note
          </h3>
          <p className="mt-1 text-small text-fg-subtle">Staff-only. Never shown to the member.</p>
          <AddNoteForm memberId={memberId} action={addAction} />
        </section>
      ) : null}
    </div>
  );
}
