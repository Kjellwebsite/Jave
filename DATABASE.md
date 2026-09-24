# Database

> Generated from `packages/database/src/schema` by `pnpm --filter @jave/database docs`. Do not edit by hand.

PostgreSQL 16 · Drizzle ORM · migrations in `packages/database/drizzle` · reference data in `src/reference-data.ts`.

## Conventions

- UUID primary keys (`gen_random_uuid()`); append-only logs use identity `bigint` keys.
- Human-facing sequential numbers (applications, tickets, cases, trials, missions, verifications) are identity columns.
- Discord snowflakes are `varchar(20)`. All timestamps are `timestamptz`.
- Soft deletion via `deleted_at` where history must survive (members, projects, evidence, research).
- Invariants live in the database: foreign keys, unique and partial unique indexes.
- Every sensitive change is also written to `audit_logs`; every meaningful change emits a `domain_events` row in the same transaction.

## Tables (73)

### Identity & ranking

#### `capability_domains`

| Column        | Type        | Null | Default | References |
| ------------- | ----------- | :--: | ------- | ---------- |
| `key` **PK**  | varchar(32) |      |         |            |
| `label`       | varchar(32) |      |         |            |
| `description` | text        |      |         |            |
| `ordinal`     | smallint    |      |         |            |

#### `capability_facets`

| Column        | Type        | Null | Default | References               |
| ------------- | ----------- | :--: | ------- | ------------------------ |
| `key` **PK**  | varchar(48) |      |         |                          |
| `domain_key`  | varchar(32) |      |         | `capability_domains.key` |
| `label`       | varchar(48) |      |         |                          |
| `description` | text        |      |         |                          |
| `ordinal`     | smallint    |      |         |                          |
| `enabled`     | boolean     |      | `true`  |                          |

#### `evidence`

| Column                | Type                                                                                                | Null | Default             | References              |
| --------------------- | --------------------------------------------------------------------------------------------------- | :--: | ------------------- | ----------------------- |
| `id` **PK**           | uuid                                                                                                |      | `gen_random_uuid()` |                         |
| `member_id`           | uuid                                                                                                |      |                     | `members.id`            |
| `kind`                | enum(link · document · project · trial · mission · achievement · contribution · evaluation · other) |      |                     |                         |
| `title`               | varchar(200)                                                                                        |      |                     |                         |
| `url`                 | text                                                                                                |  ✓   |                     |                         |
| `description`         | text                                                                                                |  ✓   |                     |                         |
| `facet_key`           | varchar(48)                                                                                         |  ✓   |                     | `capability_facets.key` |
| `source_type`         | varchar(32)                                                                                         |  ✓   |                     |                         |
| `source_id`           | uuid                                                                                                |  ✓   |                     |                         |
| `status`              | enum(submitted · accepted · rejected)                                                               |      | `"submitted"`       |                         |
| `reviewed_by_user_id` | uuid                                                                                                |  ✓   |                     | `users.id`              |
| `reviewed_at`         | timestamp with time zone                                                                            |  ✓   |                     |                         |
| `created_by_user_id`  | uuid                                                                                                |  ✓   |                     | `users.id`              |
| `created_at`          | timestamp with time zone                                                                            |      | `now()`             |                         |
| `updated_at`          | timestamp with time zone                                                                            |      | `now()`             |                         |
| `deleted_at`          | timestamp with time zone                                                                            |  ✓   |                     |                         |

- `evidence_member_idx` (member_id)
- `evidence_source_idx` (source_type, source_id)

#### `guild_member_events`

| Column             | Type                     | Null | Default  | References |
| ------------------ | ------------------------ | :--: | -------- | ---------- |
| `id` **PK**        | bigint                   |      | identity |            |
| `user_id`          | uuid                     |      |          | `users.id` |
| `type`             | enum(join · leave)       |      |          |            |
| `account_age_days` | integer                  |  ✓   |          |            |
| `occurred_at`      | timestamp with time zone |      | `now()`  |            |

- `guild_member_events_time_idx` (occurred_at)
- `guild_member_events_user_idx` (user_id)

#### `member_capabilities`

| Column                | Type                     | Null | Default             | References              |
| --------------------- | ------------------------ | :--: | ------------------- | ----------------------- |
| `id` **PK**           | uuid                     |      | `gen_random_uuid()` |                         |
| `member_id`           | uuid                     |      |                     | `members.id`            |
| `facet_key`           | varchar(48)              |      |                     | `capability_facets.key` |
| `claimed_rank`        | varchar(4)               |  ✓   |                     | `rank_tiers.code`       |
| `claimed_at`          | timestamp with time zone |  ✓   |                     |                         |
| `verified_rank`       | varchar(4)               |  ✓   |                     | `rank_tiers.code`       |
| `verified_at`         | timestamp with time zone |  ✓   |                     |                         |
| `verified_by_user_id` | uuid                     |  ✓   |                     | `users.id`              |
| `notes`               | text                     |  ✓   |                     |                         |
| `created_at`          | timestamp with time zone |      | `now()`             |                         |
| `updated_at`          | timestamp with time zone |      | `now()`             |                         |

- UNIQUE `member_capabilities_member_facet_uq` (member_id, facet_key)

#### `member_notes`

| Column           | Type                     | Null | Default             | References   |
| ---------------- | ------------------------ | :--: | ------------------- | ------------ |
| `id` **PK**      | uuid                     |      | `gen_random_uuid()` |              |
| `member_id`      | uuid                     |      |                     | `members.id` |
| `author_user_id` | uuid                     |      |                     | `users.id`   |
| `body`           | text                     |      |                     |              |
| `created_at`     | timestamp with time zone |      | `now()`             |              |
| `deleted_at`     | timestamp with time zone |  ✓   |                     |              |

- `member_notes_member_idx` (member_id)

#### `member_roles`

| Column               | Type                                                                                              | Null | Default             | References   |
| -------------------- | ------------------------------------------------------------------------------------------------- | :--: | ------------------- | ------------ |
| `id` **PK**          | uuid                                                                                              |      | `gen_random_uuid()` |              |
| `member_id`          | uuid                                                                                              |      |                     | `members.id` |
| `role`               | enum(founder · core · operations · moderator · verified · trial · applicant · member · supporter) |      |                     |              |
| `granted_by_user_id` | uuid                                                                                              |  ✓   |                     | `users.id`   |
| `reason`             | text                                                                                              |  ✓   |                     |              |
| `granted_at`         | timestamp with time zone                                                                          |      | `now()`             |              |
| `expires_at`         | timestamp with time zone                                                                          |  ✓   |                     |              |
| `revoked_at`         | timestamp with time zone                                                                          |  ✓   |                     |              |
| `revoked_by_user_id` | uuid                                                                                              |  ✓   |                     | `users.id`   |

- UNIQUE `member_roles_active_uq` (member_id, role) — partial
- `member_roles_role_idx` (role)

#### `members`

| Column                 | Type                                           | Null | Default             | References               |
| ---------------------- | ---------------------------------------------- | :--: | ------------------- | ------------------------ |
| `id` **PK**            | uuid                                           |      | `gen_random_uuid()` |                          |
| `user_id`              | uuid                                           |      |                     | `users.id`               |
| `handle`               | varchar(32)                                    |      |                     |                          |
| `display_name`         | varchar(64)                                    |      |                     |                          |
| `headline`             | varchar(160)                                   |  ✓   |                     |                          |
| `bio`                  | text                                           |  ✓   |                     |                          |
| `primary_domain`       | varchar(32)                                    |  ✓   |                     | `capability_domains.key` |
| `guild_status`         | enum(present · departed · never_joined)        |      | `"present"`         |                          |
| `standing`             | enum(good · restricted · quarantined · banned) |      | `"good"`            |                          |
| `onboarding_state`     | enum(not_started · in_progress · completed)    |      | `"not_started"`     |                          |
| `profile_visibility`   | enum(public · members · staff)                 |      | `"members"`         |                          |
| `show_claims_publicly` | boolean                                        |      | `true`              |                          |
| `show_on_leaderboards` | boolean                                        |      | `true`              |                          |
| `joined_guild_at`      | timestamp with time zone                       |  ✓   |                     |                          |
| `left_guild_at`        | timestamp with time zone                       |  ✓   |                     |                          |
| `onboarded_at`         | timestamp with time zone                       |  ✓   |                     |                          |
| `created_at`           | timestamp with time zone                       |      | `now()`             |                          |
| `updated_at`           | timestamp with time zone                       |      | `now()`             |                          |
| `deleted_at`           | timestamp with time zone                       |  ✓   |                     |                          |

- UNIQUE `members_user_id_uq` (user_id)
- UNIQUE `members_handle_uq` (handle)
- `members_guild_status_idx` (guild_status)

#### `rank_history`

| Column          | Type                                                            | Null | Default             | References              |
| --------------- | --------------------------------------------------------------- | :--: | ------------------- | ----------------------- |
| `id` **PK**     | uuid                                                            |      | `gen_random_uuid()` |                         |
| `member_id`     | uuid                                                            |      |                     | `members.id`            |
| `facet_key`     | varchar(48)                                                     |      |                     | `capability_facets.key` |
| `track`         | enum(claimed · verified)                                        |      |                     |                         |
| `from_rank`     | varchar(4)                                                      |  ✓   |                     | `rank_tiers.code`       |
| `to_rank`       | varchar(4)                                                      |  ✓   |                     | `rank_tiers.code`       |
| `source`        | enum(self · evaluator · trial · verification · system · import) |      |                     |                         |
| `source_ref`    | uuid                                                            |  ✓   |                     |                         |
| `reason`        | text                                                            |  ✓   |                     |                         |
| `evidence_id`   | uuid                                                            |  ✓   |                     | `evidence.id`           |
| `actor_user_id` | uuid                                                            |  ✓   |                     | `users.id`              |
| `created_at`    | timestamp with time zone                                        |      | `now()`             |                         |

- `rank_history_member_idx` (member_id, created_at)

#### `rank_tiers`

| Column        | Type        | Null | Default | References |
| ------------- | ----------- | :--: | ------- | ---------- |
| `code` **PK** | varchar(4)  |      |         |            |
| `ordinal`     | smallint    |      |         |            |
| `label`       | varchar(32) |      |         |            |
| `description` | text        |      |         |            |
| `enabled`     | boolean     |      | `true`  |            |

#### `sessions`

| Column         | Type                     | Null | Default             | References |
| -------------- | ------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**    | uuid                     |      | `gen_random_uuid()` |            |
| `user_id`      | uuid                     |      |                     | `users.id` |
| `token_hash`   | varchar(64)              |      |                     |            |
| `user_agent`   | varchar(256)             |  ✓   |                     |            |
| `ip_hash`      | varchar(64)              |  ✓   |                     |            |
| `created_at`   | timestamp with time zone |      | `now()`             |            |
| `expires_at`   | timestamp with time zone |      |                     |            |
| `last_seen_at` | timestamp with time zone |      | `now()`             |            |
| `revoked_at`   | timestamp with time zone |  ✓   |                     |            |

- UNIQUE `sessions_token_hash_uq` (token_hash)
- `sessions_user_idx` (user_id)

#### `user_preferences`

| Column              | Type                     | Null | Default | References |
| ------------------- | ------------------------ | :--: | ------- | ---------- |
| `user_id` **PK**    | uuid                     |      |         | `users.id` |
| `timezone`          | varchar(64)              |      | `"UTC"` |            |
| `quiet_hours_start` | smallint                 |  ✓   |         |            |
| `quiet_hours_end`   | smallint                 |  ✓   |         |            |
| `dm_notifications`  | boolean                  |      | `true`  |            |
| `updated_at`        | timestamp with time zone |      | `now()` |            |

#### `users`

| Column               | Type                     | Null | Default             | References |
| -------------------- | ------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**          | uuid                     |      | `gen_random_uuid()` |            |
| `discord_id`         | varchar(20)              |      |                     |            |
| `username`           | varchar(64)              |      |                     |            |
| `display_name`       | varchar(64)              |  ✓   |                     |            |
| `avatar_hash`        | varchar(128)             |  ✓   |                     |            |
| `is_bot`             | boolean                  |      | `false`             |            |
| `discord_created_at` | timestamp with time zone |  ✓   |                     |            |
| `created_at`         | timestamp with time zone |      | `now()`             |            |
| `updated_at`         | timestamp with time zone |      | `now()`             |            |
| `deleted_at`         | timestamp with time zone |  ✓   |                     |            |

- UNIQUE `users_discord_id_uq` (discord_id)

### Applications

#### `application_reviews`

| Column             | Type                                        | Null | Default             | References                            |
| ------------------ | ------------------------------------------- | :--: | ------------------- | ------------------------------------- |
| `id` **PK**        | uuid                                        |      | `gen_random_uuid()` |                                       |
| `application_id`   | uuid                                        |      |                     | `applications.id` (on delete cascade) |
| `reviewer_user_id` | uuid                                        |      |                     | `users.id`                            |
| `recommendation`   | enum(accept · reject · interview · abstain) |      |                     |                                       |
| `score`            | smallint                                    |  ✓   |                     |                                       |
| `note`             | text                                        |  ✓   |                     |                                       |
| `created_at`       | timestamp with time zone                    |      | `now()`             |                                       |
| `updated_at`       | timestamp with time zone                    |      | `now()`             |                                       |

- UNIQUE `application_reviews_reviewer_uq` (application_id, reviewer_user_id)

#### `application_status_changes`

| Column           | Type                                                                           | Null | Default             | References                            |
| ---------------- | ------------------------------------------------------------------------------ | :--: | ------------------- | ------------------------------------- |
| `id` **PK**      | uuid                                                                           |      | `gen_random_uuid()` |                                       |
| `application_id` | uuid                                                                           |      |                     | `applications.id` (on delete cascade) |
| `from_status`    | enum(draft · submitted · review · interview · accepted · rejected · withdrawn) |  ✓   |                     |                                       |
| `to_status`      | enum(draft · submitted · review · interview · accepted · rejected · withdrawn) |      |                     |                                       |
| `actor_user_id`  | uuid                                                                           |  ✓   |                     | `users.id`                            |
| `note`           | text                                                                           |  ✓   |                     |                                       |
| `created_at`     | timestamp with time zone                                                       |      | `now()`             |                                       |

- `application_status_changes_app_idx` (application_id, created_at)

#### `applications`

| Column                      | Type                                                                           | Null | Default             | References               |
| --------------------------- | ------------------------------------------------------------------------------ | :--: | ------------------- | ------------------------ |
| `id` **PK**                 | uuid                                                                           |      | `gen_random_uuid()` |                          |
| `number`                    | integer                                                                        |      | identity            |                          |
| `user_id`                   | uuid                                                                           |      |                     | `users.id`               |
| `status`                    | enum(draft · submitted · review · interview · accepted · rejected · withdrawn) |      | `"draft"`           |                          |
| `domain_key`                | varchar(32)                                                                    |  ✓   |                     | `capability_domains.key` |
| `experience`                | text                                                                           |  ✓   |                     |                          |
| `projects`                  | text                                                                           |  ✓   |                     |                          |
| `portfolio_url`             | text                                                                           |  ✓   |                     |                          |
| `motivation`                | text                                                                           |  ✓   |                     |                          |
| `references`                | text                                                                           |  ✓   |                     |                          |
| `evidence_links`            | text[]                                                                         |      | `'{}'::text[]`      |                          |
| `referral_code`             | varchar(32)                                                                    |  ✓   |                     |                          |
| `assigned_reviewer_user_id` | uuid                                                                           |  ✓   |                     | `users.id`               |
| `interview_at`              | timestamp with time zone                                                       |  ✓   |                     |                          |
| `submitted_at`              | timestamp with time zone                                                       |  ✓   |                     |                          |
| `decided_at`                | timestamp with time zone                                                       |  ✓   |                     |                          |
| `decided_by_user_id`        | uuid                                                                           |  ✓   |                     | `users.id`               |
| `decision_reason`           | text                                                                           |  ✓   |                     |                          |
| `applicant_message`         | text                                                                           |  ✓   |                     |                          |
| `created_at`                | timestamp with time zone                                                       |      | `now()`             |                          |
| `updated_at`                | timestamp with time zone                                                       |      | `now()`             |                          |

- UNIQUE `applications_number_uq` (number)
- UNIQUE `applications_open_per_user_uq` (user_id) — partial
- `applications_status_idx` (status, submitted_at)

### Verification

#### `verification_evidence`

| Column            | Type | Null | Default | References                             |
| ----------------- | ---- | :--: | ------- | -------------------------------------- |
| `verification_id` | uuid |      |         | `verifications.id` (on delete cascade) |
| `evidence_id`     | uuid |      |         | `evidence.id`                          |

- PRIMARY KEY (verification_id, evidence_id)

#### `verifications`

| Column                      | Type                                                                  | Null | Default             | References              |
| --------------------------- | --------------------------------------------------------------------- | :--: | ------------------- | ----------------------- |
| `id` **PK**                 | uuid                                                                  |      | `gen_random_uuid()` |                         |
| `number`                    | integer                                                               |      | identity            |                         |
| `type`                      | enum(identity · project · skill · trial · contribution · achievement) |      |                     |                         |
| `subject_member_id`         | uuid                                                                  |      |                     | `members.id`            |
| `claim`                     | text                                                                  |      |                     |                         |
| `target_type`               | varchar(32)                                                           |  ✓   |                     |                         |
| `target_id`                 | uuid                                                                  |  ✓   |                     |                         |
| `facet_key`                 | varchar(48)                                                           |  ✓   |                     | `capability_facets.key` |
| `requested_rank`            | varchar(4)                                                            |  ✓   |                     | `rank_tiers.code`       |
| `granted_rank`              | varchar(4)                                                            |  ✓   |                     | `rank_tiers.code`       |
| `status`                    | enum(pending · in_review · approved · rejected · revoked · expired)   |      | `"pending"`         |                         |
| `requested_by_user_id`      | uuid                                                                  |      |                     | `users.id`              |
| `assigned_verifier_user_id` | uuid                                                                  |  ✓   |                     | `users.id`              |
| `verifier_user_id`          | uuid                                                                  |  ✓   |                     | `users.id`              |
| `decision_note`             | text                                                                  |  ✓   |                     |                         |
| `requested_at`              | timestamp with time zone                                              |      | `now()`             |                         |
| `decided_at`                | timestamp with time zone                                              |  ✓   |                     |                         |
| `expires_at`                | timestamp with time zone                                              |  ✓   |                     |                         |
| `revoked_at`                | timestamp with time zone                                              |  ✓   |                     |                         |
| `revoked_by_user_id`        | uuid                                                                  |  ✓   |                     | `users.id`              |
| `revoke_reason`             | text                                                                  |  ✓   |                     |                         |
| `created_at`                | timestamp with time zone                                              |      | `now()`             |                         |
| `updated_at`                | timestamp with time zone                                              |      | `now()`             |                         |

- UNIQUE `verifications_number_uq` (number)
- `verifications_subject_idx` (subject_member_id)
- `verifications_status_idx` (status, requested_at)
- `verifications_target_idx` (target_type, target_id)

### Trials

#### `trial_evaluations`

| Column              | Type                     | Null | Default             | References                           |
| ------------------- | ------------------------ | :--: | ------------------- | ------------------------------------ |
| `id` **PK**         | uuid                     |      | `gen_random_uuid()` |                                      |
| `trial_id`          | uuid                     |      |                     | `trials.id` (on delete cascade)      |
| `team_id`           | uuid                     |  ✓   |                     | `trial_teams.id` (on delete cascade) |
| `member_id`         | uuid                     |  ✓   |                     | `members.id`                         |
| `evaluator_user_id` | uuid                     |      |                     | `users.id`                           |
| `overall_score`     | double precision         |      |                     |                                      |
| `notes`             | text                     |  ✓   |                     |                                      |
| `created_at`        | timestamp with time zone |      | `now()`             |                                      |
| `updated_at`        | timestamp with time zone |      | `now()`             |                                      |

- UNIQUE `trial_evaluations_team_uq` (trial_id, team_id, evaluator_user_id) — partial
- UNIQUE `trial_evaluations_member_uq` (trial_id, member_id, evaluator_user_id) — partial

#### `trial_participants`

| Column        | Type                                                        | Null | Default             | References                            |
| ------------- | ----------------------------------------------------------- | :--: | ------------------- | ------------------------------------- |
| `id` **PK**   | uuid                                                        |      | `gen_random_uuid()` |                                       |
| `trial_id`    | uuid                                                        |      |                     | `trials.id` (on delete cascade)       |
| `member_id`   | uuid                                                        |      |                     | `members.id`                          |
| `status`      | enum(applied · selected · waitlisted · withdrawn · removed) |      | `"applied"`         |                                       |
| `team_id`     | uuid                                                        |  ✓   |                     | `trial_teams.id` (on delete set null) |
| `team_role`   | enum(lead · member)                                         |  ✓   |                     |                                       |
| `statement`   | text                                                        |  ✓   |                     |                                       |
| `applied_at`  | timestamp with time zone                                    |      | `now()`             |                                       |
| `selected_at` | timestamp with time zone                                    |  ✓   |                     |                                       |
| `updated_at`  | timestamp with time zone                                    |      | `now()`             |                                       |

- UNIQUE `trial_participants_member_uq` (trial_id, member_id)
- `trial_participants_team_idx` (team_id)

#### `trial_results`

| Column             | Type                                         | Null | Default             | References                            |
| ------------------ | -------------------------------------------- | :--: | ------------------- | ------------------------------------- |
| `id` **PK**        | uuid                                         |      | `gen_random_uuid()` |                                       |
| `trial_id`         | uuid                                         |      |                     | `trials.id` (on delete cascade)       |
| `member_id`        | uuid                                         |      |                     | `members.id`                          |
| `team_id`          | uuid                                         |  ✓   |                     | `trial_teams.id` (on delete set null) |
| `team_score`       | double precision                             |  ✓   |                     |                                       |
| `individual_score` | double precision                             |  ✓   |                     |                                       |
| `final_score`      | double precision                             |  ✓   |                     |                                       |
| `outcome`          | enum(distinction · pass · fail · incomplete) |      |                     |                                       |
| `facet_key`        | varchar(48)                                  |  ✓   |                     |                                       |
| `recommended_rank` | varchar(4)                                   |  ✓   |                     | `rank_tiers.code`                     |
| `rank_history_id`  | uuid                                         |  ✓   |                     | `rank_history.id`                     |
| `published_at`     | timestamp with time zone                     |  ✓   |                     |                                       |
| `created_at`       | timestamp with time zone                     |      | `now()`             |                                       |
| `updated_at`       | timestamp with time zone                     |      | `now()`             |                                       |

- UNIQUE `trial_results_member_uq` (trial_id, member_id)

#### `trial_scores`

| Column          | Type        | Null | Default | References                                 |
| --------------- | ----------- | :--: | ------- | ------------------------------------------ |
| `evaluation_id` | uuid        |      |         | `trial_evaluations.id` (on delete cascade) |
| `criterion_key` | varchar(48) |      |         |                                            |
| `score`         | smallint    |      |         |                                            |

- PRIMARY KEY (evaluation_id, criterion_key)

#### `trial_submissions`

| Column                   | Type                     | Null | Default             | References                           |
| ------------------------ | ------------------------ | :--: | ------------------- | ------------------------------------ |
| `id` **PK**              | uuid                     |      | `gen_random_uuid()` |                                      |
| `trial_id`               | uuid                     |      |                     | `trials.id` (on delete cascade)      |
| `team_id`                | uuid                     |      |                     | `trial_teams.id` (on delete cascade) |
| `submitted_by_member_id` | uuid                     |      |                     | `members.id`                         |
| `summary`                | text                     |      |                     |                                      |
| `links`                  | text[]                   |      | `'{}'::text[]`      |                                      |
| `version`                | smallint                 |      | `1`                 |                                      |
| `is_late`                | boolean                  |      | `false`             |                                      |
| `submitted_at`           | timestamp with time zone |      | `now()`             |                                      |

- UNIQUE `trial_submissions_version_uq` (team_id, version)

#### `trial_teams`

| Column               | Type                     | Null | Default             | References                      |
| -------------------- | ------------------------ | :--: | ------------------- | ------------------------------- |
| `id` **PK**          | uuid                     |      | `gen_random_uuid()` |                                 |
| `trial_id`           | uuid                     |      |                     | `trials.id` (on delete cascade) |
| `name`               | varchar(64)              |      |                     |                                 |
| `ordinal`            | smallint                 |      |                     |                                 |
| `discord_channel_id` | varchar(20)              |  ✓   |                     |                                 |
| `discord_role_id`    | varchar(20)              |  ✓   |                     |                                 |
| `created_at`         | timestamp with time zone |      | `now()`             |                                 |

- UNIQUE `trial_teams_name_uq` (trial_id, name)

#### `trial_templates`

| Column               | Type                                                                                                                                                                        | Null | Default             | References |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**          | uuid                                                                                                                                                                        |      | `gen_random_uuid()` |            |
| `key`                | varchar(64)                                                                                                                                                                 |      |                     |            |
| `title`              | varchar(120)                                                                                                                                                                |      |                     |            |
| `category`           | enum(build · research · strategy · investigation · crisis · creation · communication · leadership · marketing · technical · security · adaptability · teamwork · execution) |      |                     |            |
| `summary`            | varchar(280)                                                                                                                                                                |      |                     |            |
| `brief`              | text                                                                                                                                                                        |      |                     |            |
| `duration_minutes`   | integer                                                                                                                                                                     |      |                     |            |
| `team_size_min`      | smallint                                                                                                                                                                    |      | `2`                 |            |
| `team_size_max`      | smallint                                                                                                                                                                    |      | `4`                 |            |
| `rubric`             | jsonb                                                                                                                                                                       |      |                     |            |
| `facet_keys`         | text[]                                                                                                                                                                      |      | `'{}'::text[]`      |            |
| `allows_adversarial` | boolean                                                                                                                                                                     |      | `false`             |            |
| `active`             | boolean                                                                                                                                                                     |      | `true`              |            |
| `created_by_user_id` | uuid                                                                                                                                                                        |  ✓   |                     | `users.id` |
| `created_at`         | timestamp with time zone                                                                                                                                                    |      | `now()`             |            |
| `updated_at`         | timestamp with time zone                                                                                                                                                    |      | `now()`             |            |

- UNIQUE `trial_templates_key_uq` (key)

#### `trials`

| Column                    | Type                                                                                                                                                                        | Null | Default             | References           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | ------------------- | -------------------- |
| `id` **PK**               | uuid                                                                                                                                                                        |      | `gen_random_uuid()` |                      |
| `number`                  | integer                                                                                                                                                                     |      | identity            |                      |
| `template_id`             | uuid                                                                                                                                                                        |  ✓   |                     | `trial_templates.id` |
| `title`                   | varchar(120)                                                                                                                                                                |      |                     |                      |
| `category`                | enum(build · research · strategy · investigation · crisis · creation · communication · leadership · marketing · technical · security · adaptability · teamwork · execution) |      |                     |                      |
| `brief`                   | text                                                                                                                                                                        |      |                     |                      |
| `rubric`                  | jsonb                                                                                                                                                                       |      |                     |                      |
| `facet_keys`              | text[]                                                                                                                                                                      |      | `'{}'::text[]`      |                      |
| `status`                  | enum(draft · recruiting · teams_assigned · active · evaluating · completed · cancelled)                                                                                     |      | `"draft"`           |                      |
| `team_size`               | smallint                                                                                                                                                                    |      | `3`                 |                      |
| `max_participants`        | integer                                                                                                                                                                     |  ✓   |                     |                      |
| `recruitment_closes_at`   | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `scheduled_start_at`      | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `duration_minutes`        | integer                                                                                                                                                                     |      |                     |                      |
| `deadline_at`             | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `started_at`              | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `submissions_closed_at`   | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `completed_at`            | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `cancelled_at`            | timestamp with time zone                                                                                                                                                    |  ✓   |                     |                      |
| `adversarial_enabled`     | boolean                                                                                                                                                                     |      | `false`             |                      |
| `discord_category_id`     | varchar(20)                                                                                                                                                                 |  ✓   |                     |                      |
| `announcement_channel_id` | varchar(20)                                                                                                                                                                 |  ✓   |                     |                      |
| `announcement_message_id` | varchar(20)                                                                                                                                                                 |  ✓   |                     |                      |
| `created_by_user_id`      | uuid                                                                                                                                                                        |  ✓   |                     | `users.id`           |
| `created_at`              | timestamp with time zone                                                                                                                                                    |      | `now()`             |                      |
| `updated_at`              | timestamp with time zone                                                                                                                                                    |      | `now()`             |                      |

- UNIQUE `trials_number_uq` (number)
- `trials_status_idx` (status)

### Adversarial (staff-only)

#### `adversarial_evaluations`

| Column                   | Type                     | Null | Default             | References                                 |
| ------------------------ | ------------------------ | :--: | ------------------- | ------------------------------------------ |
| `id` **PK**              | uuid                     |      | `gen_random_uuid()` |                                            |
| `role_id`                | uuid                     |      |                     | `adversarial_roles.id` (on delete cascade) |
| `evaluator_user_id`      | uuid                     |      |                     | `users.id`                                 |
| `security_culture_score` | smallint                 |      |                     |                                            |
| `summary`                | text                     |      |                     |                                            |
| `debrief`                | text                     |  ✓   |                     |                                            |
| `created_at`             | timestamp with time zone |      | `now()`             |                                            |
| `updated_at`             | timestamp with time zone |      | `now()`             |                                            |

- UNIQUE `adversarial_evaluations_role_uq` (role_id)

#### `adversarial_observations`

| Column              | Type                                                     | Null | Default             | References                                     |
| ------------------- | -------------------------------------------------------- | :--: | ------------------- | ---------------------------------------------- |
| `id` **PK**         | uuid                                                     |      | `gen_random_uuid()` |                                                |
| `role_id`           | uuid                                                     |      |                     | `adversarial_roles.id` (on delete cascade)     |
| `trigger_id`        | uuid                                                     |  ✓   |                     | `adversarial_triggers.id` (on delete set null) |
| `observer_user_id`  | uuid                                                     |      |                     | `users.id`                                     |
| `subject_member_id` | uuid                                                     |  ✓   |                     | `members.id`                                   |
| `outcome`           | enum(resisted · detected · reported · partial · failure) |      |                     |                                                |
| `description`       | text                                                     |      |                     |                                                |
| `occurred_at`       | timestamp with time zone                                 |      | `now()`             |                                                |
| `created_at`        | timestamp with time zone                                 |      | `now()`             |                                                |

- `adversarial_observations_role_idx` (role_id)

#### `adversarial_roles`

| Column                  | Type                                                              | Null | Default             | References                            |
| ----------------------- | ----------------------------------------------------------------- | :--: | ------------------- | ------------------------------------- |
| `id` **PK**             | uuid                                                              |      | `gen_random_uuid()` |                                       |
| `trial_id`              | uuid                                                              |      |                     | `trials.id` (on delete cascade)       |
| `team_id`               | uuid                                                              |  ✓   |                     | `trial_teams.id` (on delete set null) |
| `operative_member_id`   | uuid                                                              |      |                     | `members.id`                          |
| `scenario_id`           | uuid                                                              |      |                     | `adversarial_scenarios.id`            |
| `objective`             | text                                                              |      |                     |                                       |
| `status`                | enum(planned · briefed · active · concluded · revealed · aborted) |      | `"planned"`         |                                       |
| `authorized_by_user_id` | uuid                                                              |  ✓   |                     | `users.id`                            |
| `authorized_at`         | timestamp with time zone                                          |  ✓   |                     |                                       |
| `sandbox_attested`      | boolean                                                           |      | `false`             |                                       |
| `briefed_at`            | timestamp with time zone                                          |  ✓   |                     |                                       |
| `activated_at`          | timestamp with time zone                                          |  ✓   |                     |                                       |
| `concluded_at`          | timestamp with time zone                                          |  ✓   |                     |                                       |
| `revealed_at`           | timestamp with time zone                                          |  ✓   |                     |                                       |
| `aborted_at`            | timestamp with time zone                                          |  ✓   |                     |                                       |
| `abort_reason`          | text                                                              |  ✓   |                     |                                       |
| `created_by_user_id`    | uuid                                                              |  ✓   |                     | `users.id`                            |
| `created_at`            | timestamp with time zone                                          |      | `now()`             |                                       |
| `updated_at`            | timestamp with time zone                                          |      | `now()`             |                                       |

- `adversarial_roles_trial_idx` (trial_id)

#### `adversarial_scenarios`

| Column               | Type                                                                                                            | Null | Default             | References |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**          | uuid                                                                                                            |      | `gen_random_uuid()` |            |
| `key`                | varchar(64)                                                                                                     |      |                     |            |
| `title`              | varchar(120)                                                                                                    |      |                     |            |
| `technique`          | enum(social_engineering · instruction_integrity · permission_hygiene · data_handling · verification_discipline) |      |                     |            |
| `description`        | text                                                                                                            |      |                     |            |
| `objective`          | text                                                                                                            |      |                     |            |
| `guardrails`         | text                                                                                                            |      |                     |            |
| `sandbox_assets`     | text                                                                                                            |      |                     |            |
| `active`             | boolean                                                                                                         |      | `true`              |            |
| `created_by_user_id` | uuid                                                                                                            |  ✓   |                     | `users.id` |
| `created_at`         | timestamp with time zone                                                                                        |      | `now()`             |            |
| `updated_at`         | timestamp with time zone                                                                                        |      | `now()`             |            |

- UNIQUE `adversarial_scenarios_key_uq` (key)

#### `adversarial_triggers`

| Column        | Type                     | Null | Default             | References                                 |
| ------------- | ------------------------ | :--: | ------------------- | ------------------------------------------ |
| `id` **PK**   | uuid                     |      | `gen_random_uuid()` |                                            |
| `role_id`     | uuid                     |      |                     | `adversarial_roles.id` (on delete cascade) |
| `label`       | varchar(120)             |      |                     |                                            |
| `description` | text                     |      |                     |                                            |
| `planned_for` | timestamp with time zone |  ✓   |                     |                                            |
| `fired_at`    | timestamp with time zone |  ✓   |                     |                                            |
| `created_at`  | timestamp with time zone |      | `now()`             |                                            |

### Tickets

#### `ticket_events`

| Column          | Type                                                                                                                                                                                       | Null | Default             | References                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--: | ------------------- | -------------------------------- |
| `id` **PK**     | uuid                                                                                                                                                                                       |      | `gen_random_uuid()` |                                  |
| `ticket_id`     | uuid                                                                                                                                                                                       |      |                     | `tickets.id` (on delete cascade) |
| `type`          | enum(created · claimed · unclaimed · transferred · priority_changed · status_changed · closed · reopened · archived · note_added · summary_generated · transcript_accessed · sla_breached) |      |                     |                                  |
| `actor_user_id` | uuid                                                                                                                                                                                       |  ✓   |                     | `users.id`                       |
| `data`          | jsonb                                                                                                                                                                                      |      | `{}`                |                                  |
| `created_at`    | timestamp with time zone                                                                                                                                                                   |      | `now()`             |                                  |

- `ticket_events_ticket_idx` (ticket_id, created_at)

#### `ticket_messages`

| Column               | Type                     | Null | Default             | References                       |
| -------------------- | ------------------------ | :--: | ------------------- | -------------------------------- |
| `id` **PK**          | uuid                     |      | `gen_random_uuid()` |                                  |
| `ticket_id`          | uuid                     |      |                     | `tickets.id` (on delete cascade) |
| `author_user_id`     | uuid                     |  ✓   |                     | `users.id`                       |
| `discord_message_id` | varchar(20)              |  ✓   |                     |                                  |
| `body`               | text                     |      |                     |                                  |
| `attachments`        | jsonb                    |      | `[]`                |                                  |
| `is_internal`        | boolean                  |      | `false`             |                                  |
| `created_at`         | timestamp with time zone |      | `now()`             |                                  |
| `edited_at`          | timestamp with time zone |  ✓   |                     |                                  |
| `deleted_at`         | timestamp with time zone |  ✓   |                     |                                  |

- `ticket_messages_ticket_idx` (ticket_id, created_at)
- UNIQUE `ticket_messages_discord_uq` (discord_message_id)

#### `tickets`

| Column                      | Type                                                                                        | Null | Default             | References |
| --------------------------- | ------------------------------------------------------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**                 | uuid                                                                                        |      | `gen_random_uuid()` |            |
| `number`                    | integer                                                                                     |      | identity            |            |
| `category`                  | enum(general · application · technical · report · partnership · trial · operations · other) |      |                     |            |
| `priority`                  | enum(low · normal · high · urgent)                                                          |      | `"normal"`          |            |
| `status`                    | enum(open · claimed · waiting · closed · archived)                                          |      | `"open"`            |            |
| `subject`                   | varchar(120)                                                                                |      |                     |            |
| `opener_user_id`            | uuid                                                                                        |      |                     | `users.id` |
| `assignee_user_id`          | uuid                                                                                        |  ✓   |                     | `users.id` |
| `discord_channel_id`        | varchar(20)                                                                                 |  ✓   |                     |            |
| `discord_thread_id`         | varchar(20)                                                                                 |  ✓   |                     |            |
| `sla_first_response_due_at` | timestamp with time zone                                                                    |  ✓   |                     |            |
| `first_response_at`         | timestamp with time zone                                                                    |  ✓   |                     |            |
| `sla_breached_at`           | timestamp with time zone                                                                    |  ✓   |                     |            |
| `last_activity_at`          | timestamp with time zone                                                                    |      | `now()`             |            |
| `closed_at`                 | timestamp with time zone                                                                    |  ✓   |                     |            |
| `closed_by_user_id`         | uuid                                                                                        |  ✓   |                     | `users.id` |
| `close_reason`              | text                                                                                        |  ✓   |                     |            |
| `reopen_count`              | integer                                                                                     |      | `0`                 |            |
| `ai_summary`                | text                                                                                        |  ✓   |                     |            |
| `ai_summary_at`             | timestamp with time zone                                                                    |  ✓   |                     |            |
| `archived_at`               | timestamp with time zone                                                                    |  ✓   |                     |            |
| `created_at`                | timestamp with time zone                                                                    |      | `now()`             |            |
| `updated_at`                | timestamp with time zone                                                                    |      | `now()`             |            |

- UNIQUE `tickets_number_uq` (number)
- UNIQUE `tickets_thread_uq` (discord_thread_id)
- `tickets_status_idx` (status, created_at)
- `tickets_assignee_idx` (assignee_user_id)
- `tickets_opener_idx` (opener_user_id)

### Moderation & security

#### `mod_cases`

| Column               | Type                                                                                | Null | Default             | References           |
| -------------------- | ----------------------------------------------------------------------------------- | :--: | ------------------- | -------------------- |
| `id` **PK**          | uuid                                                                                |      | `gen_random_uuid()` |                      |
| `number`             | integer                                                                             |      | identity            |                      |
| `action`             | enum(warn · timeout · untimeout · kick · ban · unban · quarantine · release · note) |      |                     |                      |
| `target_user_id`     | uuid                                                                                |      |                     | `users.id`           |
| `moderator_user_id`  | uuid                                                                                |  ✓   |                     | `users.id`           |
| `reason`             | text                                                                                |      |                     |                      |
| `duration_seconds`   | integer                                                                             |  ✓   |                     |                      |
| `expires_at`         | timestamp with time zone                                                            |  ✓   |                     |                      |
| `source`             | enum(manual · automod · ai_suggested · security_event)                              |      | `"manual"`          |                      |
| `security_event_id`  | uuid                                                                                |  ✓   |                     | `security_events.id` |
| `discord_sync`       | enum(pending · applied · failed · not_required)                                     |      | `"pending"`         |                      |
| `discord_error`      | text                                                                                |  ✓   |                     |                      |
| `revoked_at`         | timestamp with time zone                                                            |  ✓   |                     |                      |
| `revoked_by_user_id` | uuid                                                                                |  ✓   |                     | `users.id`           |
| `revoke_reason`      | text                                                                                |  ✓   |                     |                      |
| `created_at`         | timestamp with time zone                                                            |      | `now()`             |                      |
| `updated_at`         | timestamp with time zone                                                            |      | `now()`             |                      |

- UNIQUE `mod_cases_number_uq` (number)
- `mod_cases_target_idx` (target_user_id, created_at)
- `mod_cases_time_idx` (created_at)

#### `security_events`

| Column                | Type                                                                                                                                 | Null | Default             | References |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**           | uuid                                                                                                                                 |      | `gen_random_uuid()` |            |
| `user_id`             | uuid                                                                                                                                 |  ✓   |                     | `users.id` |
| `risk_score`          | smallint                                                                                                                             |      |                     |            |
| `trigger`             | enum(spam_rate · duplicate_content · mention_spam · blocked_link · foreign_invite · join_burst · suspicious_account · manual_report) |      |                     |            |
| `evidence`            | jsonb                                                                                                                                |      |                     |            |
| `action_taken`        | enum(none · flagged · message_deleted · timeout · quarantine · kick · ban · lockdown)                                                |      | `"none"`            |            |
| `status`              | enum(open · acknowledged · dismissed · actioned)                                                                                     |      | `"open"`            |            |
| `channel_id`          | varchar(20)                                                                                                                          |  ✓   |                     |            |
| `reviewed_by_user_id` | uuid                                                                                                                                 |  ✓   |                     | `users.id` |
| `reviewed_at`         | timestamp with time zone                                                                                                             |  ✓   |                     |            |
| `review_note`         | text                                                                                                                                 |  ✓   |                     |            |
| `created_at`          | timestamp with time zone                                                                                                             |      | `now()`             |            |

- `security_events_time_idx` (created_at)
- `security_events_user_idx` (user_id)
- `security_events_status_idx` (status)

### Invites & referrals

#### `campaigns`

| Column               | Type                     | Null | Default             | References |
| -------------------- | ------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**          | uuid                     |      | `gen_random_uuid()` |            |
| `key`                | varchar(48)              |      |                     |            |
| `name`               | varchar(120)             |      |                     |            |
| `description`        | text                     |  ✓   |                     |            |
| `starts_at`          | timestamp with time zone |  ✓   |                     |            |
| `ends_at`            | timestamp with time zone |  ✓   |                     |            |
| `active`             | boolean                  |      | `true`              |            |
| `created_by_user_id` | uuid                     |  ✓   |                     | `users.id` |
| `created_at`         | timestamp with time zone |      | `now()`             |            |
| `updated_at`         | timestamp with time zone |      | `now()`             |            |

- UNIQUE `campaigns_key_uq` (key)

#### `invite_codes`

| Column            | Type                     | Null | Default | References     |
| ----------------- | ------------------------ | :--: | ------- | -------------- |
| `code` **PK**     | varchar(32)              |      |         |                |
| `inviter_user_id` | uuid                     |  ✓   |         | `users.id`     |
| `channel_id`      | varchar(20)              |  ✓   |         |                |
| `uses`            | integer                  |      | `0`     |                |
| `max_uses`        | integer                  |  ✓   |         |                |
| `temporary`       | boolean                  |      | `false` |                |
| `campaign_id`     | uuid                     |  ✓   |         | `campaigns.id` |
| `created_at`      | timestamp with time zone |      | `now()` |                |
| `expires_at`      | timestamp with time zone |  ✓   |         |                |
| `deleted_at`      | timestamp with time zone |  ✓   |         |                |
| `last_synced_at`  | timestamp with time zone |  ✓   |         |                |

- `invite_codes_inviter_idx` (inviter_user_id)

#### `referral_codes`

| Column          | Type                     | Null | Default | References     |
| --------------- | ------------------------ | :--: | ------- | -------------- |
| `code` **PK**   | varchar(32)              |      |         |                |
| `owner_user_id` | uuid                     |      |         | `users.id`     |
| `campaign_id`   | uuid                     |  ✓   |         | `campaigns.id` |
| `active`        | boolean                  |      | `true`  |                |
| `created_at`    | timestamp with time zone |      | `now()` |                |

- `referral_codes_owner_idx` (owner_user_id)

#### `referrals`

| Column            | Type                                             | Null | Default             | References            |
| ----------------- | ------------------------------------------------ | :--: | ------------------- | --------------------- |
| `id` **PK**       | uuid                                             |      | `gen_random_uuid()` |                       |
| `invitee_user_id` | uuid                                             |      |                     | `users.id`            |
| `inviter_user_id` | uuid                                             |  ✓   |                     | `users.id`            |
| `invite_code`     | varchar(32)                                      |  ✓   |                     |                       |
| `referral_code`   | varchar(32)                                      |  ✓   |                     | `referral_codes.code` |
| `campaign_id`     | uuid                                             |  ✓   |                     | `campaigns.id`        |
| `method`          | enum(invite · referral_code · vanity · unknown)  |      |                     |                       |
| `status`          | enum(joined · retained · valid · left · invalid) |      | `"joined"`          |                       |
| `joined_at`       | timestamp with time zone                         |      | `now()`             |                       |
| `left_at`         | timestamp with time zone                         |  ✓   |                     |                       |
| `retained_at`     | timestamp with time zone                         |  ✓   |                     |                       |
| `validated_at`    | timestamp with time zone                         |  ✓   |                     |                       |
| `anomaly_flags`   | text[]                                           |      | `'{}'::text[]`      |                       |
| `anomaly_score`   | smallint                                         |      | `0`                 |                       |
| `created_at`      | timestamp with time zone                         |      | `now()`             |                       |
| `updated_at`      | timestamp with time zone                         |      | `now()`             |                       |

- `referrals_inviter_idx` (inviter_user_id, status)
- `referrals_invitee_idx` (invitee_user_id)
- `referrals_joined_idx` (joined_at)

### Achievements

#### `achievement_definitions`

| Column                  | Type                                                     | Null | Default      | References              |
| ----------------------- | -------------------------------------------------------- | :--: | ------------ | ----------------------- |
| `key` **PK**            | varchar(64)                                              |      |              |                         |
| `title`                 | varchar(64)                                              |      |              |                         |
| `description`           | text                                                     |      |              |                         |
| `category`              | varchar(32)                                              |      |              |                         |
| `rarity`                | enum(standard · notable · rare · exceptional · singular) |      | `"standard"` |                         |
| `visibility`            | enum(public · hidden)                                    |      | `"public"`   |                         |
| `criteria`              | jsonb                                                    |      |              |                         |
| `requires_verification` | boolean                                                  |      | `false`      |                         |
| `facet_key`             | varchar(48)                                              |  ✓   |              | `capability_facets.key` |
| `active`                | boolean                                                  |      | `true`       |                         |
| `ordinal`               | smallint                                                 |      | `0`          |                         |
| `created_at`            | timestamp with time zone                                 |      | `now()`      |                         |
| `updated_at`            | timestamp with time zone                                 |      | `now()`      |                         |

#### `member_achievements`

| Column                | Type                        | Null | Default             | References                    |
| --------------------- | --------------------------- | :--: | ------------------- | ----------------------------- |
| `id` **PK**           | uuid                        |      | `gen_random_uuid()` |                               |
| `member_id`           | uuid                        |      |                     | `members.id`                  |
| `achievement_key`     | varchar(64)                 |      |                     | `achievement_definitions.key` |
| `awarded_at`          | timestamp with time zone    |      | `now()`             |                               |
| `awarded_by_user_id`  | uuid                        |  ✓   |                     | `users.id`                    |
| `source_event_id`     | bigint                      |  ✓   |                     |                               |
| `verification`        | enum(unverified · verified) |      | `"unverified"`      |                               |
| `verified_by_user_id` | uuid                        |  ✓   |                     | `users.id`                    |
| `verified_at`         | timestamp with time zone    |  ✓   |                     |                               |
| `note`                | text                        |  ✓   |                     |                               |
| `revoked_at`          | timestamp with time zone    |  ✓   |                     |                               |
| `revoke_reason`       | text                        |  ✓   |                     |                               |

- UNIQUE `member_achievements_active_uq` (member_id, achievement_key) — partial
- `member_achievements_key_idx` (achievement_key)

### Projects & contributions

#### `contributions`

| Column                | Type                                                                               | Null | Default             | References    |
| --------------------- | ---------------------------------------------------------------------------------- | :--: | ------------------- | ------------- |
| `id` **PK**           | uuid                                                                               |      | `gen_random_uuid()` |               |
| `member_id`           | uuid                                                                               |      |                     | `members.id`  |
| `project_id`          | uuid                                                                               |  ✓   |                     | `projects.id` |
| `kind`                | enum(code · research · design · writing · operations · mentoring · review · other) |      |                     |               |
| `title`               | varchar(200)                                                                       |      |                     |               |
| `description`         | text                                                                               |  ✓   |                     |               |
| `url`                 | text                                                                               |  ✓   |                     |               |
| `source`              | enum(manual · github · system)                                                     |      | `"manual"`          |               |
| `external_ref`        | varchar(200)                                                                       |  ✓   |                     |               |
| `status`              | enum(submitted · verified · rejected)                                              |      | `"submitted"`       |               |
| `verified_by_user_id` | uuid                                                                               |  ✓   |                     | `users.id`    |
| `verified_at`         | timestamp with time zone                                                           |  ✓   |                     |               |
| `occurred_at`         | timestamp with time zone                                                           |      | `now()`             |               |
| `created_at`          | timestamp with time zone                                                           |      | `now()`             |               |
| `updated_at`          | timestamp with time zone                                                           |      | `now()`             |               |

- UNIQUE `contributions_external_ref_uq` (external_ref)
- `contributions_member_idx` (member_id, status)
- `contributions_project_idx` (project_id)

#### `project_links`

| Column       | Type        | Null | Default             | References                        |
| ------------ | ----------- | :--: | ------------------- | --------------------------------- |
| `id` **PK**  | uuid        |      | `gen_random_uuid()` |                                   |
| `project_id` | uuid        |      |                     | `projects.id` (on delete cascade) |
| `label`      | varchar(48) |      |                     |                                   |
| `url`        | text        |      |                     |                                   |
| `ordinal`    | smallint    |      | `0`                 |                                   |

#### `project_members`

| Column       | Type                                   | Null | Default             | References                        |
| ------------ | -------------------------------------- | :--: | ------------------- | --------------------------------- |
| `id` **PK**  | uuid                                   |      | `gen_random_uuid()` |                                   |
| `project_id` | uuid                                   |      |                     | `projects.id` (on delete cascade) |
| `member_id`  | uuid                                   |      |                     | `members.id`                      |
| `role`       | enum(owner · maintainer · contributor) |      | `"contributor"`     |                                   |
| `joined_at`  | timestamp with time zone               |      | `now()`             |                                   |
| `left_at`    | timestamp with time zone               |  ✓   |                     |                                   |

- UNIQUE `project_members_uq` (project_id, member_id)
- `project_members_member_idx` (member_id)

#### `project_milestones`

| Column         | Type                                    | Null | Default             | References                        |
| -------------- | --------------------------------------- | :--: | ------------------- | --------------------------------- |
| `id` **PK**    | uuid                                    |      | `gen_random_uuid()` |                                   |
| `project_id`   | uuid                                    |      |                     | `projects.id` (on delete cascade) |
| `title`        | varchar(120)                            |      |                     |                                   |
| `description`  | text                                    |  ✓   |                     |                                   |
| `status`       | enum(planned · active · done · dropped) |      | `"planned"`         |                                   |
| `due_at`       | timestamp with time zone                |  ✓   |                     |                                   |
| `completed_at` | timestamp with time zone                |  ✓   |                     |                                   |
| `ordinal`      | smallint                                |      | `0`                 |                                   |
| `created_at`   | timestamp with time zone                |      | `now()`             |                                   |
| `updated_at`   | timestamp with time zone                |      | `now()`             |                                   |

- `project_milestones_project_idx` (project_id)

#### `projects`

| Column            | Type                                                            | Null | Default             | References               |
| ----------------- | --------------------------------------------------------------- | :--: | ------------------- | ------------------------ |
| `id` **PK**       | uuid                                                            |      | `gen_random_uuid()` |                          |
| `slug`            | varchar(64)                                                     |      |                     |                          |
| `title`           | varchar(120)                                                    |      |                     |                          |
| `summary`         | varchar(280)                                                    |  ✓   |                     |                          |
| `description`     | text                                                            |  ✓   |                     |                          |
| `owner_member_id` | uuid                                                            |      |                     | `members.id`             |
| `status`          | enum(idea · planning · building · testing · shipped · archived) |      | `"idea"`            |                          |
| `domain_key`      | varchar(32)                                                     |  ✓   |                     | `capability_domains.key` |
| `goals`           | text                                                            |  ✓   |                     |                          |
| `visibility`      | enum(public · members · private)                                |      | `"members"`         |                          |
| `github_repo`     | varchar(140)                                                    |  ✓   |                     |                          |
| `repo_url`        | text                                                            |  ✓   |                     |                          |
| `website_url`     | text                                                            |  ✓   |                     |                          |
| `shipped_at`      | timestamp with time zone                                        |  ✓   |                     |                          |
| `archived_at`     | timestamp with time zone                                        |  ✓   |                     |                          |
| `created_at`      | timestamp with time zone                                        |      | `now()`             |                          |
| `updated_at`      | timestamp with time zone                                        |      | `now()`             |                          |
| `deleted_at`      | timestamp with time zone                                        |  ✓   |                     |                          |

- UNIQUE `projects_slug_uq` (slug)
- UNIQUE `projects_github_repo_uq` (github_repo)
- `projects_status_idx` (status)
- `projects_owner_idx` (owner_member_id)

### Missions

#### `mission_assignments`

| Column                | Type                                                                              | Null | Default             | References                        |
| --------------------- | --------------------------------------------------------------------------------- | :--: | ------------------- | --------------------------------- |
| `id` **PK**           | uuid                                                                              |      | `gen_random_uuid()` |                                   |
| `mission_id`          | uuid                                                                              |      |                     | `missions.id` (on delete cascade) |
| `member_id`           | uuid                                                                              |      |                     | `members.id`                      |
| `team_key`            | varchar(32)                                                                       |  ✓   |                     |                                   |
| `status`              | enum(assigned · accepted · submitted · verified · rejected · expired · abandoned) |      | `"assigned"`        |                                   |
| `assigned_by_user_id` | uuid                                                                              |  ✓   |                     | `users.id`                        |
| `assigned_at`         | timestamp with time zone                                                          |      | `now()`             |                                   |
| `accepted_at`         | timestamp with time zone                                                          |  ✓   |                     |                                   |
| `due_at`              | timestamp with time zone                                                          |  ✓   |                     |                                   |
| `submitted_at`        | timestamp with time zone                                                          |  ✓   |                     |                                   |
| `submission`          | text                                                                              |  ✓   |                     |                                   |
| `evidence_id`         | uuid                                                                              |  ✓   |                     | `evidence.id`                     |
| `verified_by_user_id` | uuid                                                                              |  ✓   |                     | `users.id`                        |
| `verified_at`         | timestamp with time zone                                                          |  ✓   |                     |                                   |
| `feedback`            | text                                                                              |  ✓   |                     |                                   |
| `created_at`          | timestamp with time zone                                                          |      | `now()`             |                                   |
| `updated_at`          | timestamp with time zone                                                          |      | `now()`             |                                   |

- UNIQUE `mission_assignments_member_uq` (mission_id, member_id)
- `mission_assignments_member_idx` (member_id, status)
- `mission_assignments_due_idx` (status, due_at)

#### `missions`

| Column                   | Type                                                                                 | Null | Default             | References                    |
| ------------------------ | ------------------------------------------------------------------------------------ | :--: | ------------------- | ----------------------------- |
| `id` **PK**              | uuid                                                                                 |      | `gen_random_uuid()` |                               |
| `number`                 | integer                                                                              |      | identity            |                               |
| `title`                  | varchar(120)                                                                         |      |                     |                               |
| `brief`                  | text                                                                                 |      |                     |                               |
| `type`                   | enum(individual · team · research · build · social · physical · strategy · creative) |      |                     |                               |
| `status`                 | enum(draft · open · closed · archived)                                               |      | `"draft"`           |                               |
| `facet_key`              | varchar(48)                                                                          |  ✓   |                     | `capability_facets.key`       |
| `evidence_required`      | boolean                                                                              |      | `true`              |                               |
| `reward_achievement_key` | varchar(64)                                                                          |  ✓   |                     | `achievement_definitions.key` |
| `reward_note`            | varchar(200)                                                                         |  ✓   |                     |                               |
| `max_assignees`          | integer                                                                              |  ✓   |                     |                               |
| `self_assignable`        | boolean                                                                              |      | `true`              |                               |
| `deadline_at`            | timestamp with time zone                                                             |  ✓   |                     |                               |
| `duration_hours`         | integer                                                                              |  ✓   |                     |                               |
| `created_by_user_id`     | uuid                                                                                 |  ✓   |                     | `users.id`                    |
| `created_at`             | timestamp with time zone                                                             |      | `now()`             |                               |
| `updated_at`             | timestamp with time zone                                                             |      | `now()`             |                               |
| `archived_at`            | timestamp with time zone                                                             |  ✓   |                     |                               |

- UNIQUE `missions_number_uq` (number)
- `missions_status_idx` (status)

### Events & tournaments

#### `event_rsvps`

| Column          | Type                                      | Null | Default             | References                      |
| --------------- | ----------------------------------------- | :--: | ------------------- | ------------------------------- |
| `id` **PK**     | uuid                                      |      | `gen_random_uuid()` |                                 |
| `event_id`      | uuid                                      |      |                     | `events.id` (on delete cascade) |
| `member_id`     | uuid                                      |      |                     | `members.id`                    |
| `status`        | enum(going · maybe · declined · waitlist) |      |                     |                                 |
| `responded_at`  | timestamp with time zone                  |      | `now()`             |                                 |
| `checked_in_at` | timestamp with time zone                  |  ✓   |                     |                                 |

- UNIQUE `event_rsvps_uq` (event_id, member_id)
- `event_rsvps_member_idx` (member_id)

#### `event_team_members`

| Column      | Type | Null | Default | References                           |
| ----------- | ---- | :--: | ------- | ------------------------------------ |
| `team_id`   | uuid |      |         | `event_teams.id` (on delete cascade) |
| `member_id` | uuid |      |         | `members.id`                         |

- PRIMARY KEY (team_id, member_id)

#### `event_teams`

| Column       | Type                     | Null | Default             | References                      |
| ------------ | ------------------------ | :--: | ------------------- | ------------------------------- |
| `id` **PK**  | uuid                     |      | `gen_random_uuid()` |                                 |
| `event_id`   | uuid                     |      |                     | `events.id` (on delete cascade) |
| `name`       | varchar(64)              |      |                     |                                 |
| `seed`       | smallint                 |  ✓   |                     |                                 |
| `created_at` | timestamp with time zone |      | `now()`             |                                 |

- UNIQUE `event_teams_name_uq` (event_id, name)

#### `events`

| Column                       | Type                                                                   | Null | Default             | References   |
| ---------------------------- | ---------------------------------------------------------------------- | :--: | ------------------- | ------------ |
| `id` **PK**                  | uuid                                                                   |      | `gen_random_uuid()` |              |
| `title`                      | varchar(120)                                                           |      |                     |              |
| `description`                | text                                                                   |  ✓   |                     |              |
| `kind`                       | enum(meetup · workshop · talk · tournament · session · social · other) |      |                     |              |
| `status`                     | enum(scheduled · live · completed · cancelled)                         |      | `"scheduled"`       |              |
| `starts_at`                  | timestamp with time zone                                               |      |                     |              |
| `ends_at`                    | timestamp with time zone                                               |  ✓   |                     |              |
| `location`                   | varchar(200)                                                           |  ✓   |                     |              |
| `discord_scheduled_event_id` | varchar(20)                                                            |  ✓   |                     |              |
| `capacity`                   | integer                                                                |  ✓   |                     |              |
| `rsvp_closes_at`             | timestamp with time zone                                               |  ✓   |                     |              |
| `check_in_code_hash`         | varchar(64)                                                            |  ✓   |                     |              |
| `host_member_id`             | uuid                                                                   |  ✓   |                     | `members.id` |
| `created_by_user_id`         | uuid                                                                   |  ✓   |                     | `users.id`   |
| `cancelled_at`               | timestamp with time zone                                               |  ✓   |                     |              |
| `created_at`                 | timestamp with time zone                                               |      | `now()`             |              |
| `updated_at`                 | timestamp with time zone                                               |      | `now()`             |              |

- `events_starts_idx` (status, starts_at)

#### `tournament_matches`

| Column           | Type                                    | Null | Default             | References                      |
| ---------------- | --------------------------------------- | :--: | ------------------- | ------------------------------- |
| `id` **PK**      | uuid                                    |      | `gen_random_uuid()` |                                 |
| `event_id`       | uuid                                    |      |                     | `events.id` (on delete cascade) |
| `round`          | smallint                                |      |                     |                                 |
| `position`       | smallint                                |      |                     |                                 |
| `team_a_id`      | uuid                                    |  ✓   |                     | `event_teams.id`                |
| `team_b_id`      | uuid                                    |  ✓   |                     | `event_teams.id`                |
| `winner_team_id` | uuid                                    |  ✓   |                     | `event_teams.id`                |
| `score_a`        | integer                                 |  ✓   |                     |                                 |
| `score_b`        | integer                                 |  ✓   |                     |                                 |
| `status`         | enum(pending · ready · completed · bye) |      | `"pending"`         |                                 |
| `next_match_id`  | uuid                                    |  ✓   |                     | `tournament_matches.id`         |
| `next_slot`      | enum(a · b)                             |  ✓   |                     |                                 |
| `completed_at`   | timestamp with time zone                |  ✓   |                     |                                 |
| `created_at`     | timestamp with time zone                |      | `now()`             |                                 |

- UNIQUE `tournament_matches_pos_uq` (event_id, round, position)

### Notifications

#### `notification_deliveries`

| Column            | Type                                                             | Null | Default             | References                             |
| ----------------- | ---------------------------------------------------------------- | :--: | ------------------- | -------------------------------------- |
| `id` **PK**       | uuid                                                             |      | `gen_random_uuid()` |                                        |
| `notification_id` | uuid                                                             |      |                     | `notifications.id` (on delete cascade) |
| `channel`         | enum(discord_dm · discord_channel · dashboard · email · webhook) |      |                     |                                        |
| `status`          | enum(pending · deferred · sent · failed · skipped)               |      | `"pending"`         |                                        |
| `attempts`        | smallint                                                         |      | `0`                 |                                        |
| `last_error`      | text                                                             |  ✓   |                     |                                        |
| `deliver_after`   | timestamp with time zone                                         |  ✓   |                     |                                        |
| `sent_at`         | timestamp with time zone                                         |  ✓   |                     |                                        |
| `created_at`      | timestamp with time zone                                         |      | `now()`             |                                        |

- UNIQUE `notification_deliveries_uq` (notification_id, channel)
- `notification_deliveries_status_idx` (status, deliver_after)

#### `notification_preferences`

| Column    | Type                                                             | Null | Default | References |
| --------- | ---------------------------------------------------------------- | :--: | ------- | ---------- |
| `user_id` | uuid                                                             |      |         | `users.id` |
| `type`    | varchar(64)                                                      |      |         |            |
| `channel` | enum(discord_dm · discord_channel · dashboard · email · webhook) |      |         |            |
| `enabled` | boolean                                                          |      |         |            |

- PRIMARY KEY (user_id, type, channel)

#### `notifications`

| Column              | Type                                       | Null | Default             | References |
| ------------------- | ------------------------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**         | uuid                                       |      | `gen_random_uuid()` |            |
| `recipient_user_id` | uuid                                       |      |                     | `users.id` |
| `type`              | varchar(64)                                |      |                     |            |
| `severity`          | enum(info · notice · important · critical) |      | `"info"`            |            |
| `title`             | varchar(120)                               |      |                     |            |
| `body`              | text                                       |      |                     |            |
| `url`               | text                                       |  ✓   |                     |            |
| `data`              | jsonb                                      |      | `{}`                |            |
| `dedupe_key`        | varchar(200)                               |  ✓   |                     |            |
| `created_at`        | timestamp with time zone                   |      | `now()`             |            |
| `read_at`           | timestamp with time zone                   |  ✓   |                     |            |

- UNIQUE `notifications_dedupe_uq` (dedupe_key)
- `notifications_recipient_idx` (recipient_user_id, created_at)

### AI

#### `ai_action_proposals`

| Column                 | Type                                                               | Null | Default             | References       |
| ---------------------- | ------------------------------------------------------------------ | :--: | ------------------- | ---------------- |
| `id` **PK**            | uuid                                                               |      | `gen_random_uuid()` |                  |
| `kind`                 | varchar(48)                                                        |      |                     |                  |
| `requested_by_user_id` | uuid                                                               |      |                     | `users.id`       |
| `ai_request_id`        | uuid                                                               |  ✓   |                     | `ai_requests.id` |
| `payload`              | jsonb                                                              |      |                     |                  |
| `preview`              | text                                                               |      |                     |                  |
| `status`               | enum(pending · confirmed · executed · rejected · expired · failed) |      | `"pending"`         |                  |
| `decided_by_user_id`   | uuid                                                               |  ✓   |                     | `users.id`       |
| `decided_at`           | timestamp with time zone                                           |  ✓   |                     |                  |
| `executed_at`          | timestamp with time zone                                           |  ✓   |                     |                  |
| `result`               | jsonb                                                              |  ✓   |                     |                  |
| `error`                | text                                                               |  ✓   |                     |                  |
| `expires_at`           | timestamp with time zone                                           |      |                     |                  |
| `created_at`           | timestamp with time zone                                           |      | `now()`             |                  |

- `ai_action_proposals_status_idx` (status, created_at)

#### `ai_requests`

| Column          | Type                                                 | Null | Default             | References |
| --------------- | ---------------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**     | uuid                                                 |      | `gen_random_uuid()` |            |
| `user_id`       | uuid                                                 |  ✓   |                     | `users.id` |
| `feature`       | varchar(32)                                          |      |                     |            |
| `provider`      | varchar(32)                                          |      |                     |            |
| `model`         | varchar(64)                                          |      |                     |            |
| `status`        | enum(ok · error · refused · rate_limited · disabled) |      |                     |            |
| `input_tokens`  | integer                                              |      | `0`                 |            |
| `output_tokens` | integer                                              |      | `0`                 |            |
| `latency_ms`    | integer                                              |      | `0`                 |            |
| `error_code`    | varchar(64)                                          |  ✓   |                     |            |
| `prompt_hash`   | varchar(64)                                          |  ✓   |                     |            |
| `created_at`    | timestamp with time zone                             |      | `now()`             |            |

- `ai_requests_user_idx` (user_id, created_at)
- `ai_requests_time_idx` (created_at)

### Research (Sidus)

#### `research_items`

| Column                 | Type                                                                                     | Null | Default             | References |
| ---------------------- | ---------------------------------------------------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**            | uuid                                                                                     |      | `gen_random_uuid()` |            |
| `title`                | varchar(300)                                                                             |      |                     |            |
| `authors`              | text[]                                                                                   |      | `'{}'::text[]`      |            |
| `source`               | varchar(120)                                                                             |  ✓   |                     |            |
| `url`                  | text                                                                                     |  ✓   |                     |            |
| `canonical_url`        | text                                                                                     |  ✓   |                     |            |
| `doi`                  | varchar(200)                                                                             |  ✓   |                     |            |
| `arxiv_id`             | varchar(32)                                                                              |  ✓   |                     |            |
| `topic`                | varchar(80)                                                                              |  ✓   |                     |            |
| `tags`                 | text[]                                                                                   |      | `'{}'::text[]`      |            |
| `summary`              | text                                                                                     |  ✓   |                     |            |
| `evidence_level`       | enum(unknown · anecdotal · observational · experimental · peer_reviewed · meta_analysis) |      | `"unknown"`         |            |
| `status`               | enum(new · needs_review · reviewed · verified · archived)                                |      | `"new"`             |            |
| `published_on`         | date                                                                                     |  ✓   |                     |            |
| `submitted_by_user_id` | uuid                                                                                     |      |                     | `users.id` |
| `reviewed_by_user_id`  | uuid                                                                                     |  ✓   |                     | `users.id` |
| `reviewed_at`          | timestamp with time zone                                                                 |  ✓   |                     |            |
| `discord_message_id`   | varchar(20)                                                                              |  ✓   |                     |            |
| `discord_message_url`  | text                                                                                     |  ✓   |                     |            |
| `sidus_sync_status`    | enum(not_synced · pending · synced · failed)                                             |      | `"not_synced"`      |            |
| `sidus_external_id`    | varchar(128)                                                                             |  ✓   |                     |            |
| `sidus_synced_at`      | timestamp with time zone                                                                 |  ✓   |                     |            |
| `created_at`           | timestamp with time zone                                                                 |      | `now()`             |            |
| `updated_at`           | timestamp with time zone                                                                 |      | `now()`             |            |
| `deleted_at`           | timestamp with time zone                                                                 |  ✓   |                     |            |

- UNIQUE `research_items_doi_uq` (doi)
- UNIQUE `research_items_canonical_url_uq` (canonical_url)
- UNIQUE `research_items_discord_message_uq` (discord_message_id)
- `research_items_status_idx` (status, created_at)

### Integrations & webhooks

#### `integrations`

| Column               | Type                                                   | Null | Default             | References |
| -------------------- | ------------------------------------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**          | uuid                                                   |      | `gen_random_uuid()` |            |
| `provider`           | enum(github · generic · sidus · supabase · monitoring) |      |                     |            |
| `name`               | varchar(80)                                            |      |                     |            |
| `slug`               | varchar(48)                                            |      |                     |            |
| `enabled`            | boolean                                                |      | `true`              |            |
| `config`             | jsonb                                                  |      | `{}`                |            |
| `secret_ciphertext`  | text                                                   |  ✓   |                     |            |
| `last_event_at`      | timestamp with time zone                               |  ✓   |                     |            |
| `last_error_at`      | timestamp with time zone                               |  ✓   |                     |            |
| `last_error`         | text                                                   |  ✓   |                     |            |
| `created_by_user_id` | uuid                                                   |  ✓   |                     | `users.id` |
| `created_at`         | timestamp with time zone                               |      | `now()`             |            |
| `updated_at`         | timestamp with time zone                               |      | `now()`             |            |

- UNIQUE `integrations_slug_uq` (slug)

#### `outbound_deliveries`

| Column            | Type                                                              | Null | Default             | References                                 |
| ----------------- | ----------------------------------------------------------------- | :--: | ------------------- | ------------------------------------------ |
| `id` **PK**       | uuid                                                              |      | `gen_random_uuid()` |                                            |
| `webhook_id`      | uuid                                                              |      |                     | `outbound_webhooks.id` (on delete cascade) |
| `event_id`        | bigint                                                            |      |                     |                                            |
| `event_type`      | varchar(64)                                                       |      |                     |                                            |
| `status`          | enum(received · processing · processed · ignored · failed · dead) |      | `"received"`        |                                            |
| `response_status` | smallint                                                          |  ✓   |                     |                                            |
| `attempts`        | smallint                                                          |      | `0`                 |                                            |
| `last_error`      | text                                                              |  ✓   |                     |                                            |
| `created_at`      | timestamp with time zone                                          |      | `now()`             |                                            |
| `delivered_at`    | timestamp with time zone                                          |  ✓   |                     |                                            |

- UNIQUE `outbound_deliveries_uq` (webhook_id, event_id)

#### `outbound_webhooks`

| Column                 | Type                     | Null | Default             | References |
| ---------------------- | ------------------------ | :--: | ------------------- | ---------- |
| `id` **PK**            | uuid                     |      | `gen_random_uuid()` |            |
| `name`                 | varchar(80)              |      |                     |            |
| `url`                  | text                     |      |                     |            |
| `event_types`          | text[]                   |      | `'{}'::text[]`      |            |
| `secret_ciphertext`    | text                     |      |                     |            |
| `enabled`              | boolean                  |      | `true`              |            |
| `consecutive_failures` | integer                  |      | `0`                 |            |
| `last_delivery_at`     | timestamp with time zone |  ✓   |                     |            |
| `created_by_user_id`   | uuid                     |  ✓   |                     | `users.id` |
| `created_at`           | timestamp with time zone |      | `now()`             |            |
| `updated_at`           | timestamp with time zone |      | `now()`             |            |

#### `webhook_deliveries`

| Column           | Type                                                              | Null | Default             | References        |
| ---------------- | ----------------------------------------------------------------- | :--: | ------------------- | ----------------- |
| `id` **PK**      | uuid                                                              |      | `gen_random_uuid()` |                   |
| `integration_id` | uuid                                                              |  ✓   |                     | `integrations.id` |
| `provider`       | enum(github · generic · sidus · supabase · monitoring)            |      |                     |                   |
| `delivery_id`    | varchar(128)                                                      |      |                     |                   |
| `event_type`     | varchar(64)                                                       |      |                     |                   |
| `status`         | enum(received · processing · processed · ignored · failed · dead) |      | `"received"`        |                   |
| `payload`        | jsonb                                                             |      |                     |                   |
| `attempts`       | smallint                                                          |      | `0`                 |                   |
| `last_error`     | text                                                              |  ✓   |                     |                   |
| `received_at`    | timestamp with time zone                                          |      | `now()`             |                   |
| `processed_at`   | timestamp with time zone                                          |  ✓   |                     |                   |

- UNIQUE `webhook_deliveries_idempotency_uq` (provider, delivery_id)
- `webhook_deliveries_status_idx` (status, received_at)

### Games

#### `game_moves`

| Column       | Type                     | Null | Default  | References                             |
| ------------ | ------------------------ | :--: | -------- | -------------------------------------- |
| `id` **PK**  | bigint                   |      | identity |                                        |
| `session_id` | uuid                     |      |          | `game_sessions.id` (on delete cascade) |
| `user_id`    | uuid                     |      |          | `users.id`                             |
| `round`      | smallint                 |      |          |                                        |
| `move`       | jsonb                    |      |          |                                        |
| `correct`    | boolean                  |  ✓   |          |                                        |
| `points`     | integer                  |      | `0`      |                                        |
| `created_at` | timestamp with time zone |      | `now()`  |                                        |

- UNIQUE `game_moves_round_uq` (session_id, user_id, round)

#### `game_players`

| Column       | Type                     | Null | Default             | References                             |
| ------------ | ------------------------ | :--: | ------------------- | -------------------------------------- |
| `id` **PK**  | uuid                     |      | `gen_random_uuid()` |                                        |
| `session_id` | uuid                     |      |                     | `game_sessions.id` (on delete cascade) |
| `user_id`    | uuid                     |      |                     | `users.id`                             |
| `team`       | varchar(32)              |  ✓   |                     |                                        |
| `score`      | integer                  |      | `0`                 |                                        |
| `placement`  | smallint                 |  ✓   |                     |                                        |
| `joined_at`  | timestamp with time zone |      | `now()`             |                                        |

- UNIQUE `game_players_uq` (session_id, user_id)
- `game_players_user_idx` (user_id)

#### `game_sessions`

| Column                 | Type                                         | Null | Default             | References |
| ---------------------- | -------------------------------------------- | :--: | ------------------- | ---------- |
| `id` **PK**            | uuid                                         |      | `gen_random_uuid()` |            |
| `game_key`             | varchar(32)                                  |      |                     |            |
| `status`               | enum(lobby · active · completed · abandoned) |      | `"lobby"`           |            |
| `surface`              | enum(discord · activity · dashboard)         |      |                     |            |
| `host_user_id`         | uuid                                         |      |                     | `users.id` |
| `discord_channel_id`   | varchar(20)                                  |  ✓   |                     |            |
| `discord_message_id`   | varchar(20)                                  |  ✓   |                     |            |
| `activity_instance_id` | varchar(128)                                 |  ✓   |                     |            |
| `seed`                 | varchar(64)                                  |      |                     |            |
| `config`               | jsonb                                        |      | `{}`                |            |
| `state`                | jsonb                                        |      | `{}`                |            |
| `version`              | integer                                      |      | `0`                 |            |
| `started_at`           | timestamp with time zone                     |  ✓   |                     |            |
| `ended_at`             | timestamp with time zone                     |  ✓   |                     |            |
| `created_at`           | timestamp with time zone                     |      | `now()`             |            |
| `updated_at`           | timestamp with time zone                     |      | `now()`             |            |

- `game_sessions_status_idx` (game_key, status)
- `game_sessions_activity_idx` (activity_instance_id)

### Platform

#### `analytics_snapshots`

| Column       | Type                     | Null | Default | References |
| ------------ | ------------------------ | :--: | ------- | ---------- |
| `day`        | date                     |      |         |            |
| `metric`     | varchar(64)              |      |         |            |
| `dimension`  | varchar(64)              |      | `""`    |            |
| `value`      | double precision         |      |         |            |
| `created_at` | timestamp with time zone |      | `now()` |            |

- UNIQUE `analytics_snapshots_uq` (day, metric, dimension)

#### `audit_logs`

| Column          | Type                                   | Null | Default     | References |
| --------------- | -------------------------------------- | :--: | ----------- | ---------- |
| `id` **PK**     | bigint                                 |      | identity    |            |
| `actor_type`    | enum(user · system · ai · integration) |      |             |            |
| `actor_user_id` | uuid                                   |  ✓   |             | `users.id` |
| `action`        | varchar(64)                            |      |             |            |
| `target_type`   | varchar(32)                            |  ✓   |             |            |
| `target_id`     | varchar(64)                            |  ✓   |             |            |
| `context`       | jsonb                                  |      | `{}`        |            |
| `result`        | enum(success · denied · failure)       |      | `"success"` |            |
| `request_id`    | varchar(64)                            |  ✓   |             |            |
| `created_at`    | timestamp with time zone               |      | `now()`     |            |

- `audit_logs_time_idx` (created_at)
- `audit_logs_actor_idx` (actor_user_id, created_at)
- `audit_logs_target_idx` (target_type, target_id)
- `audit_logs_action_idx` (action, created_at)

#### `domain_events`

| Column              | Type                     | Null | Default  | References |
| ------------------- | ------------------------ | :--: | -------- | ---------- |
| `id` **PK**         | bigint                   |      | identity |            |
| `type`              | varchar(64)              |      |          |            |
| `aggregate_type`    | varchar(32)              |      |          |            |
| `aggregate_id`      | varchar(64)              |      |          |            |
| `actor_user_id`     | uuid                     |  ✓   |          | `users.id` |
| `subject_member_id` | uuid                     |  ✓   |          |            |
| `payload`           | jsonb                    |      | `{}`     |            |
| `occurred_at`       | timestamp with time zone |      | `now()`  |            |

- `domain_events_type_subject_idx` (type, subject_member_id)
- `domain_events_aggregate_idx` (aggregate_type, aggregate_id)
- `domain_events_time_idx` (occurred_at)

#### `jobs`

| Column         | Type                                                            | Null | Default     | References |
| -------------- | --------------------------------------------------------------- | :--: | ----------- | ---------- |
| `id` **PK**    | bigint                                                          |      | identity    |            |
| `type`         | varchar(64)                                                     |      |             |            |
| `payload`      | jsonb                                                           |      | `{}`        |            |
| `status`       | enum(pending · running · completed · failed · dead · cancelled) |      | `"pending"` |            |
| `run_at`       | timestamp with time zone                                        |      | `now()`     |            |
| `attempts`     | smallint                                                        |      | `0`         |            |
| `max_attempts` | smallint                                                        |      | `5`         |            |
| `locked_at`    | timestamp with time zone                                        |  ✓   |             |            |
| `locked_by`    | varchar(64)                                                     |  ✓   |             |            |
| `last_error`   | text                                                            |  ✓   |             |            |
| `result`       | jsonb                                                           |  ✓   |             |            |
| `dedupe_key`   | varchar(200)                                                    |  ✓   |             |            |
| `created_at`   | timestamp with time zone                                        |      | `now()`     |            |
| `completed_at` | timestamp with time zone                                        |  ✓   |             |            |

- `jobs_ready_idx` (status, run_at)
- UNIQUE `jobs_dedupe_live_uq` (dedupe_key) — partial

#### `rate_limit_buckets`

| Column         | Type                     | Null | Default | References |
| -------------- | ------------------------ | :--: | ------- | ---------- |
| `key` **PK**   | varchar(160)             |      |         |            |
| `window_start` | timestamp with time zone |      |         |            |
| `count`        | smallint                 |      | `0`     |            |

#### `server_settings`

| Column               | Type                     | Null | Default | References |
| -------------------- | ------------------------ | :--: | ------- | ---------- |
| `section` **PK**     | varchar(32)              |      |         |            |
| `value`              | jsonb                    |      |         |            |
| `version`            | integer                  |      | `1`     |            |
| `updated_by_user_id` | uuid                     |  ✓   |         | `users.id` |
| `updated_at`         | timestamp with time zone |      | `now()` |            |
