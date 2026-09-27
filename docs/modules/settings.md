# Settings

`packages/core/src/settings` · table `server_settings` (one validated JSON document per
section) · capabilities `canViewSettings`, `canManageSettings`.

Sections: branding, roles, channels, moderation, security, tickets, applications, trials, ai,
integrations, notifications, analytics (`schemas.ts`). Every field has a default, so an empty
database works; secrets never live here (they come from the environment).

## Reading

`getSettings(ctx, section)` returns the stored section merged over the defaults, cached per
process for 15 seconds. It does not authorize: services read the settings they need.
`getAllSettings(ctx)` is the authorized read for surfaces (`canViewSettings`). A stored section
that no longer validates falls back to its defaults instead of taking a process down.

## Writing

`updateSettings(ctx, section, patch)` (`canManageSettings`):

- **Fresh and serialized.** The current section is read from the database inside the
  transaction — never from the per-process cache. The bot and the dashboard cache independently,
  so merging over a cached copy would silently undo a change made in the other process within the
  cache lifetime. Writes of one section take a transaction-scoped advisory lock first (a row lock
  would not cover the section's very first write, when no row exists yet).
- **Patch.** Either a partial value merged over the current one, or a function of the current
  value returning that partial (`SettingsPatch`). Use the function form for fields derived from
  what is stored now, such as one entry of the role mapping.
- **Validated** with the section schema (`ValidationError` with every issue's path).
- **Atomic.** The new value, its audit entry (`settings.updated`, field-level `{ from, to }`
  diff) and its domain event commit together; a patch that changes nothing writes nothing. The
  process cache is invalidated after the commit.

### Role mapping invariants (`roles`)

- A Discord role backs at most one JAVE role (`… is already mapped to MEMBER`).
- The quarantine role is never a mapped role (quarantine strips every mapped role, it would strip
  its own).
- A change to `discordRoleIds`, or `syncToDiscord` switched back on, re-syncs every present member
  (`scheduleRoleResyncForAll`): one `discord.roles.sync` job per member with
  `{ dedupeKey: roles-sync:<memberId>, rerunIfRunning: true }`, inserted in the same transaction
  and deliberately not run inline by the interaction that made the change.

What only Discord can know (a role's position, whether it is managed, the permissions it grants,
whether a channel is the right kind) is checked by the bot before it calls `updateSettings` and
again by `/jave setup`.

## Events and audit

| Event / action     | When                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `settings.updated` | Every change; payload `{ section, fields }` (internal, never external). |
| `access.denied`    | Refused reads or writes (audited durably by `authorize`).               |

Subscriber: `adversarial.kill-switch` aborts every live adversarial role once
`trials.adversarialEnabled` is off.

## Surfaces

Full Discord reference: [`docs/commands/core.md`](../commands/core.md).

- **Discord** (`apps/bot/src/features/core`): `/settings view` (summary), `/settings channel`
  (channel outputs, native channel picker filtered to the kinds each output accepts),
  `/settings role` (JAVE role or QUARANTINE → native role picker; refuses @everyone, managed
  roles and elevated roles behind non-staff JAVE roles; the mapping is written as a function
  patch), `/settings toggle` (16 boolean flags, sensitive ones confirmed first), and
  `/jave setup`, the readiness checklist of permissions, role hierarchy, role mapping and
  channels, with buttons into the matching panels.
- **Dashboard** (`apps/dashboard/app/(console)/settings`): one form per section; read-only
  without `canManageSettings`.
- **Development seed** (`pnpm db:seed`): maps placeholder ticket channels so tickets can be opened
  from the dashboard; `/jave setup` flags them against a real guild.
