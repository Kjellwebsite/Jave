import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Badge,
  Mono,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import type { invites } from '@jave/core';
import { formatDate } from '@/lib/time';

const COLUMNS = 5;

function usesText(invite: invites.InviteCodeView): string {
  return invite.maxUses ? `${invite.uses} / ${invite.maxUses}` : String(invite.uses);
}

/**
 * Discord invites mirrored by the bot, most used first. `actions` renders a
 * trailing control per row (e.g. detach) on the campaign page.
 */
export function InvitesTable({
  items,
  campaignNames,
  timeZone,
  caption = 'Invites',
  empty,
  actions,
}: {
  items: readonly invites.InviteCodeView[];
  /** Campaign id → name, for the campaign column (omitted when absent). */
  campaignNames?: ReadonlyMap<string, string>;
  timeZone: string;
  caption?: string;
  empty: { title: string; description: string };
  actions?: (invite: invites.InviteCodeView) => ReactNode;
}) {
  const showCampaign = campaignNames !== undefined;
  return (
    <Table caption={caption}>
      <TableHead>
        <tr>
          <TableHeaderCell>Invite</TableHeaderCell>
          <TableHeaderCell className="text-right">Uses</TableHeaderCell>
          {showCampaign ? (
            <TableHeaderCell className="hidden md:table-cell">Campaign</TableHeaderCell>
          ) : null}
          <TableHeaderCell className="hidden sm:table-cell">Expires</TableHeaderCell>
          {actions ? (
            <TableHeaderCell className="text-right">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          ) : null}
        </tr>
      </TableHead>
      <TableBody>
        {items.length === 0 ? (
          <TableEmptyRow colSpan={COLUMNS} {...empty} />
        ) : (
          items.map((invite) => {
            const campaignName = invite.campaignId ? campaignNames?.get(invite.campaignId) : null;
            return (
              <TableRow key={invite.code}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <Mono className="text-fg">{invite.code}</Mono>
                    {invite.vanity ? <Badge>Vanity URL</Badge> : null}
                    {invite.temporary ? <Badge>Temporary</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-small text-fg-subtle">
                    {invite.vanity
                      ? 'The server’s vanity URL'
                      : (invite.inviterName ?? 'Unknown inviter')}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Mono className={invite.uses > 0 ? 'text-fg' : undefined}>
                    {usesText(invite)}
                  </Mono>
                </TableCell>
                {showCampaign ? (
                  <TableCell className="hidden md:table-cell">
                    {invite.campaignId && campaignName ? (
                      <Link
                        href={`/referrals/campaigns/${invite.campaignId}`}
                        className="text-small text-fg-muted hover:text-fg"
                      >
                        {campaignName}
                      </Link>
                    ) : (
                      <Mono dim aria-label="none">
                        —
                      </Mono>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="hidden sm:table-cell">
                  <Mono dim>
                    {invite.expiresAt ? formatDate(invite.expiresAt, timeZone) : 'never'}
                  </Mono>
                </TableCell>
                {actions ? <TableCell className="text-right">{actions(invite)}</TableCell> : null}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
