# Module: projects

`packages/core/src/projects` — projects, membership, links, milestones, the
project activity feed, and contributions. Schema: `packages/database/src/schema/projects.ts`.

```ts
import { projects } from '@jave/core';
await projects.createProject(ctx, { title: 'Rocket Engine', visibility: 'public' });
```

## Purpose

A project is the unit of shipped work in JAVELIN. Members create projects,
move them through a lifecycle, invite collaborators, and record contributions.
Contributions become **VERIFIED** only when someone other than the author
vouches for them (staff, a project owner/maintainer, or a merged pull request
by a staff-verified GitHub account). Project activity never becomes capability
by itself: pushes are activity, not contributions.

## State machines

### Project status

```
IDEA ⇄ PLANNING ⇄ BUILDING ⇄ TESTING ──► SHIPPED ──► (BUILDING | TESTING: next iteration)
(any non-archived) ──► ARCHIVED ──staff unarchive──► status it was archived from
```

| From     | Allowed targets                      |
| -------- | ------------------------------------ |
| idea     | planning, building, archived         |
| planning | idea, building, archived             |
| building | planning, testing, shipped, archived |
| testing  | building, shipped, archived          |
| shipped  | building, testing, archived          |
| archived | — (staff `unarchiveProject` only)    |

The table lives in `status.ts` (`PROJECT_TRANSITIONS`, pure, unit-tested).

- **Shipping** stamps `shippedAt` the first time only and emits one
  `project.shipped` per active member (`subjectMemberId` = that member) so
  achievements count per person. Re-shipping after another iteration never
  re-emits (no achievement loops).
- **Archiving** (owner or staff) records `archivedFromStatus`, freezes edits,
  links, milestones and membership changes (members can still leave).
- **Unarchive** (staff, `canManageProjects`, reason required, audited) restores
  the status the project was archived from (IDEA if unknown).
- Status updates are conditional (`WHERE status = <expected>`): concurrent
  changes resolve to one winner and a `ConflictError` for the other.

### Contribution status

`submitted ──► verified | rejected` (terminal). Verify/reject are
conditional updates, so concurrent reviews apply once.

### Milestones

`planned ⇄ active ⇄ dropped`, `planned/active ──completeMilestone──► done`;
moving a done milestone back to planned/active reopens it (clears `completedAt`).

## Roles and permissions

| Action                                        | Who                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| create project                                | member in good standing (≤ 20 active owned, ≤ 5 started per day)                  |
| edit details, links, milestones, status, repo | owner, maintainer, `canManageProjects`                                            |
| change visibility, archive, change roles      | owner, `canManageProjects`                                                        |
| transfer ownership                            | owner, `canManageProjects`                                                        |
| add/remove contributors                       | owner, maintainer, `canManageProjects`                                            |
| add/remove maintainers                        | owner, `canManageProjects`                                                        |
| unarchive                                     | `canManageProjects` only                                                          |
| leave                                         | any member except the owner                                                       |
| record contribution                           | yourself; project optional, only if you're on it                                  |
| verify / reject contribution                  | `canVerifyContributions`, or owner/maintainer of its project — **never your own** |

Membership-derived rights need good standing: quarantined/banned members lose
them, restricted members keep read access only. Ownership moves only through
`transferProjectOwnership` (the previous owner becomes maintainer); a partial
unique index guarantees one active owner per project.

### Visibility (enforced on every read)

| Visibility | Who can see it                                                |
| ---------- | ------------------------------------------------------------- |
| public     | everyone, including anonymous visitors                        |
| members    | signed-in users with `canViewMembers`, project members, staff |
| private    | active project members and `canManageProjects`                |

Invisible projects return `NotFoundError` (never `ForbiddenError`), for
reads **and** writes, so private projects cannot be probed. Links and
milestones are addressed as `(projectId, itemId)` and must belong to that
project (IDOR guard). Member names on project pages respect each member's
profile visibility for outsiders (`hiddenMemberCount` counts the rest).

Contribution listing is row-level: reviewers see everything, authors see their
own, project owners/maintainers see their project's, everyone else sees only
VERIFIED contributions of visible profiles on visible projects. Review notes
are shown only to the author and reviewers.

## Services

| Function                                                                                                         | Notes                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `createProject`, `updateProject`                                                                                 | unique slug from the title (`rocket-engine`, `rocket-engine-2`; route names reserved)                      |
| `changeProjectStatus`, `unarchiveProject`                                                                        | see state machine                                                                                          |
| `linkGithubRepo`                                                                                                 | `owner/name` or a github.com URL, stored lowercase, unique, audited; `null` unlinks                        |
| `addProjectMember`, `removeProjectMember`, `leaveProject`, `changeProjectMemberRole`, `transferProjectOwnership` | ≤ 50 active members                                                                                        |
| `addProjectLink`, `updateProjectLink`, `removeProjectLink`, `reorderProjectLinks`                                | http(s) only, no credentials, ≤ 12                                                                         |
| `addMilestone`, `updateMilestone`, `completeMilestone`, `removeMilestone`, `reorderMilestones`                   | ≤ 50; reorder requires an exact permutation                                                                |
| `getProject` (`{ projectId }` or `{ slug }`), `listProjects`                                                     | filters: status, visibility, memberId, ownerMemberId, domainKey, search, includeArchived; sort; pagination |
| `getProjectActivity`                                                                                             | project-aggregate domain events, newest first, paginated                                                   |
| `recordContribution`, `verifyContribution`, `rejectContribution`, `listContributions`                            | ≤ 25 pending per member; future dates refused                                                              |
| `recordExternalContribution`                                                                                     | system actor only; idempotent per `externalRef` (used by integrations)                                     |
| `findProjectByGithubRepo`                                                                                        | system actor only (bypasses visibility)                                                                    |

All free text is trimmed, length-capped and rejects control characters;
titles and labels are single-line. URLs must be absolute http(s) without
embedded credentials and are normalized before storage.

## Events

| Event                           | External | Subject member     | Emitted by                                    |
| ------------------------------- | -------- | ------------------ | --------------------------------------------- |
| `project.created`               | yes      | owner              | createProject                                 |
| `project.updated`               | no       | —                  | details, links, milestones (payload `change`) |
| `project.status_changed`        | yes      | —                  | changeProjectStatus, unarchiveProject         |
| `project.shipped`               | yes      | each active member | first ship only                               |
| `project.member_added`          | no       | added member       | addProjectMember                              |
| `project.member_removed`        | no       | removed member     | removeProjectMember, leaveProject             |
| `project.member_role_changed`   | no       | member             | changeProjectMemberRole                       |
| `project.ownership_transferred` | no       | new owner          | transferProjectOwnership                      |
| `project.milestone_completed`   | no       | —                  | completeMilestone                             |
| `project.repo_linked`           | no       | —                  | linkGithubRepo                                |
| `project.github_push`           | no       | —                  | integrations (push to default branch)         |
| `project.release_published`     | yes      | —                  | integrations (GitHub release)                 |
| `contribution.submitted`        | no       | author             | record*                                       |
| `contribution.verified`         | yes      | author             | verify, auto-verified GitHub PRs              |
| `contribution.rejected`         | no       | author             | rejectContribution                            |

`project.updated` carries a `change` marker: `details` (with `fields`),
`link_added | link_updated | link_removed`, or
`milestone_added | milestone_updated | milestone_removed`.

Every project/contribution event payload carries `visibility`. Outbound
webhooks deliver only events whose payload visibility is `public` (or absent),
so private and members-only projects never leave JAVE.

`contribution.verified` carries `verifiedBy`: `staff`, `project` (peer review
by a project owner/maintainer), `github` (merged PR by a verified account) —
consumers can weight them differently. `project.shipped` carries `teamSize`,
`projectAgeDays`, `verifiedContributions` (project-wide) and
`memberVerifiedContributions` (that member's) for the same reason: an
achievement can require shipped work that someone else has verified.

The activity feed hides `project.shipped` (one row per member) because the
single `project.status_changed` already shows it.

## Notifications

| Type                   | When                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `project.updated`      | status changes (other members), added/removed/role change, ownership transfer |
| `contribution.updated` | contribution verified, rejected, or recorded from GitHub                      |

Copy examples: `PROJECT SHIPPED — Rocket Engine — now SHIPPED.`,
`PROJECT ACCESS — Rocket Engine — you were added as CONTRIBUTOR.`,
`CONTRIBUTION VERIFIED — PR #12 — Faster parser — verified.`

## Audit

`project.visibility_changed`, `project.archived`, `project.unarchived`,
`project.repo_linked`, `project.member_added|removed|left|role_changed`,
`project.ownership_transferred`, `contribution.verified|rejected`,
`contribution.self_review_blocked` (durable, result `denied`), and
`access.denied` for every refused management action.

## Jobs and Discord job contracts

None. The projects module has no background work and no Discord side effects
of its own (GitHub processing lives in the integrations module).

## Extension points

- Achievements subscribe to `project.shipped` / `contribution.verified`
  (per-member `subjectMemberId`).
- `recordExternalContribution` is the entry point for any future
  integration-sourced contribution (source `github` or `system`).

## Known limitations

- Shipping is self-declared. Achievements should not treat `project.shipped`
  as verified capability; `teamSize`, `projectAgeDays` and the verified
  contribution counts help filter throwaway projects. Creation is capped
  (`MAX_PROJECTS_CREATED_PER_DAY` = 5, archived ones included) so
  create → ship → archive loops cannot be run at scale.
- Peer verification by project owners/maintainers can be collusive (two
  members verifying each other). `verifiedBy: 'project'` marks those.
- Members can be added without an invitation step; they are notified and can
  leave at any time.
- A repository linked by one project blocks others until unlinked (staff can
  edit any project).
- There is no hard delete; archive instead.
