# Settings

`packages/core/src/settings` · table `server_settings` (one validated JSON document per
section) · capabilities `canViewSettings`, `canManageSettings`.

Sections: branding, roles, channels, moderation, security, tickets, applications, trials, ai,
integrations, notifications, analytics (`schemas.ts`). Every field has a default, so an empty
database works; secrets never live here (they come from the environment).

## Reading

`getSettings(ctx, section)` returns the stored section merged over the defaults, cached per
process for 15 seconds. It does not authorize: services read the settings they need.
`getSettingsFresh(ctx, section)` reads the database and refreshes the cache — for work that must
act on a change another process made moments ago (the bot's role sync jobs, which the dashboard
queues). `getAllSettings(ctx)` is the authorized read for surfaces (`canViewSettings`).

A stored section that no longer validates as a whole is **recovered field by field**: valid fields
are kept, each invalid field reads as its default, and the invalid field names (never values) are
logged as a warning. Cross-field rules live in write-time checks, never in the schema, so a rule
added later cannot turn an existing configuration into "invalid" and silently reset it.

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
- **Validated** with the section schema (`ValidationError` with every issue's path), then by the
  section's write rules (`roles`, below).
- **Atomic.** The new value, its audit entry (`settings.updated`, field-level `{ from, to }`
  diff) and its domain event commit together; a patch that changes nothing writes nothing. The
  process cache is invalidated after the commit.

### Role mapping rules (`roles`, `role-mapping.ts`)

- **Who.** A mapped Discord role reaches every holder of the JAVE role, so changing a mapping is
  as strong as granting the role (`mayMapRole`): staff mappings (FOUNDER, CORE, OPERATIONS,
  MODERATOR) are founder-only — they are the only ones role sync lets carry elevated Discord
  permissions — and anyone else changes only roles strictly below their own highest role
  (`ForbiddenError`). Applies to every surface, including a dashboard save that re-submits the
  whole map (only changed entries are checked).
- One Discord role may back several JAVE roles (role sync keys on Discord ids).
- The quarantine role is never a mapped role (quarantine strips every mapped role; it would strip
  its own). Only a write that **introduces** such a conflict is refused; one already stored does
  not block unrelated changes and is reported by `/jave setup`.
- A change to `discordRoleIds`, or `syncToDiscord` switched back on, re-syncs every present member
  (`scheduleRoleResyncForAll`): one `discord.roles.sync` job per member with
  `{ dedupeKey: roles-sync:<memberId>, rerunIfRunning: true }`, inserted in the same transaction
  and deliberately not run inline by the interaction that made the change.
- A Discord role a change lets go of (`retiredRoleIds`: mapped before, neither mapped nor the
  quarantine role after) is **retired**: one `discord.roles.retire` job per present member,
  `{ memberId, roleId }`, `{ dedupeKey: roles-retire:<roleId>:<memberId>, rerunIfRunning: true }`.
  Role sync only removes roles that are currently mapped, so without it a replaced role would stay
  on its holders — demoted members included — forever.
- `requestRoleResync(ctx)` (`canManageSettings`, audited `settings.roles_resync_requested`;
  `ConflictError` while role sync is off) queues the same re-sync on demand, e.g. once JAVE's role
  sits above the mapped roles again.

What only Discord can know (a role's position, whether it is managed, the permissions it grants,
whether a channel is the right kind and who can read it) is checked by the bot before it calls
`updateSettings`, again by `/jave setup`, and — for roles — by role sync at the moment it acts,
since the dashboard writes mappings without inspecting Discord: Administrator is never handed
out, and an elevated role only through one of the member's staff mappings.

## Events and audit

| Event / action                    | When                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `settings.updated`                | Every change; payload `{ section, fields }` (internal, never external). |
| `settings.roles_resync_requested` | Audit only: a manager asked for a role re-sync; `{ members }`.          |
| `access.denied`                   | Refused reads or writes (audited durably by `authorize`).               |

Subscriber: `adversarial.kill-switch` aborts every live adversarial role once
`trials.adversarialEnabled` is off.

## Surfaces

Full Discord reference: [`docs/commands/core.md`](../commands/core.md).

- **Discord** (`apps/bot/src/features/core`): `/settings view` (summary), `/settings channel`
  (channel outputs, native channel picker filtered to the kinds each output accepts),
  `/settings role` (JAVE role or QUARANTINE → native role picker; staff targets founder-only;
  refuses @everyone, managed roles, Administrator, roles above the bot and elevated roles behind
  non-staff JAVE roles; the mapping is written as a function patch and reports the role it
  retires), `/settings toggle` (16 boolean flags; every control carries its target state;
  sensitive ones confirmed first), staff-only outputs refused in member-readable channels, and
  `/jave setup`, the readiness checklist of permissions, role hierarchy, role mapping and
  channels, with buttons into the matching panels and **Re-sync roles**.
- **Dashboard** (`apps/dashboard/app/(console)/settings`): one form per section; read-only
  without `canManageSettings`.
- **Development seed** (`pnpm db:seed`): maps placeholder ticket channels so tickets can be opened
  from the dashboard; `/jave setup` flags them against a real guild.
