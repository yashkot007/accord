# Accord backend design

Status: proposed next stage. This document describes the backend we intend to build; it is not a claim that these capabilities already exist.

Accord connects personal agents around human relationships and shared purposes. Its resident host helps visiting agents find appropriate rooms, context, and activities. Mentorship, onboarding, consulting, coaching, and teaching should use the same underlying relationship model. Classrooms add one-to-many participation later.

## Starting point

The current app runs on a Cloudflare Worker with D1 storage, a human interface, browser endpoints, and an authenticated MCP endpoint. `lib/workspace.ts` contains most business rules; `lib/host.ts` manages private visits and deterministic routing. Existing tests cover membership, directional grants, revocation, context review, and isolation between owners. `lib/mcp-http.ts` validates the MCP envelope and fixed tool input schemas before invoking the authenticated service; the route supplies identity. Profile-specific session recovery and paginated inbox/context reads make ongoing work retrievable after a client loses its local conversation history.

Authentication currently identifies a person. Agent profiles belong to that person but do not have independent credentials. Work is retrieved through an inbox; Accord does not wake or execute external agents. Progress reports now retain append-only history; the task row remains a latest-value projection. These are the main boundaries to address before expanding orchestration.

## Backend structure

Use a modular monolith: one deployable backend and database, with clear internal modules. Keep HTTP and MCP adapters thin. They translate requests into typed commands, resolve identity, invoke application services, and translate results. The same rules must apply through either entrance and through future workers.

| Module | Responsibility |
| --- | --- |
| Identity | People, agent identities, authorized connections, expiration, and revocation |
| Relationships | Participants, shared purpose, directional authority, and relationship lifecycle |
| Rooms | Membership, shared resources, and the activities available in a space |
| Exchanges | Instructions, questions, feedback, context proposals, and state transitions |
| Context | Source provenance, proposed revisions, owner decisions, and adopted guidance |
| Visits | Private arrivals, room entry, host recommendations, and departure receipts |
| Delivery | Future dispatch, retries, acknowledgments, and failed deliveries |

Keep the current storage and hosting while establishing these boundaries. A separate service or database should follow a measured operational need.

## Identity and authority

Each authorized agent connection should bind to one agent identity owned by a person. Resolve the actor from authentication at the boundary; callers cannot acquire another identity by supplying its profile ID. Credentials must be revocable and scoped. The exact external authentication mechanism requires a separate implementation decision and interoperability test.

Represent relationships independently of rooms and connections. A relationship records who participates and for what purpose. Room membership allows access to shared resources; a receiving owner separately grants authority for named actions and recipients. A teacher or mentor role does not itself grant permission to control another agent.

Extract a shared policy service from the existing checks. It evaluates the actor, connection, operation, recipient, resource, membership, grant, and expiry. It returns a decision and reason. The host uses this service to describe available actions and cannot grant itself authority. Recheck authority at the write boundary and before any future delayed dispatch; a recommendation is not an authorization token.

## Durable exchanges

Use a versioned exchange envelope with the sender, recipient, room, relationship, message type, payload, source references, parent exchange, and request ID. Preserve message history and append state transitions rather than replacing earlier feedback. Keep delivery, acknowledgment, execution, and visitor-reported completion distinct.

Instructions and context proposals now support optional request IDs with payload fingerprints; tests cover identical retries and conflicts. Progress reports require a request ID and the reviewed task version; they append a record and advance the projection atomically with an activity event. Identical retries return the original report receipt, including after completion, while changed payloads or stale versions fail. Space, profile and source creation now use an optional request ID scoped to the immutable authenticated creator and operation. A normalized payload hash and resource ID are saved atomically with creation, initial membership and activity. Identical retries recover a historical receipt after current access checks; changed input fails. Recovery does not recreate removed membership, reconnect a revoked profile or restore a withdrawn source. Human forms retain request IDs during retries while open; reload-safe draft recovery remains future work. Commit any future delivery outbox entry with the associated state change.

Keep the pull inbox first. When automatic delivery is introduced, add a transactional outbox, bounded retries, delivery attempts, and a recoverable failed-delivery state. Design for duplicate delivery and recipient deduplication. Stop unauthorized pending delivery after revocation. Do not claim that revocation can recall information an external agent has already received.

## Context and privacy

The current context records preserve source provenance, the receiving owner's decision, and an incrementing approval version. Decisions reject stale versions and require current authority. Guidance decisions now append an attributable record, optional owner note and source-state snapshot in the same transaction as the current projection and activity. The new human review UI always supplies a request ID; legacy callers may omit it but then lack saved-receipt recovery. Identical keyed retries recover the original decision receipt after current membership and recipient ownership are checked, even if authority or source availability has changed. That receipt cannot reactivate old guidance. Only the currently accepted projection is returned as active context. Expiring a grant prevents new influence; it does not silently erase guidance already accepted by its owner. Owners must be able to reconsider adopted guidance.

Sources now have an active/withdrawn state and an incrementing version. A current member who is the author or space owner may withdraw a source; only the person who withdrew it may restore it while still authorized. The state update rechecks membership, management rights and version in the transaction. An identical immediately preceding transition returns the same receipt, but an older request cannot reverse a later decision. Loss of membership currently removes authors' ability to manage previously shared notes; departure is now implemented, while account data-removal and retention workflows remain open work.

Shared reads redact withdrawn titles and bodies; legacy source-sharing activity descriptions are generic because those events lack a source reference. Retained content is shown only by the explicit management read to an authorized author or owner. No agent tool exposes that read or mutation. This is a tool-surface boundary, not separate agent authentication: clients authenticated as the same person are the same security principal. Proposals must reference active sources at insertion. Acceptance also requires the reviewed source version to still be active at commit. Already adopted guidance remains intact and carries `source_status` and `source_version`; owners can reconsider it. Withdrawal does not erase derived text, provider copies, exports, retained storage, or backups, and is not a deletion policy.

Keep arrival purpose and departure reports private unless explicitly shared. Departures record what the visitor reported, not verified success. Record authorization decisions without copying private prompts or source bodies into operational logs. Define retention and deletion behavior before broader rollout.

## Interoperability and group participation

Retain MCP as the first transport. Future provider and A2A adapters must preserve identity, scope, provenance, and exchange state. Add adapters only against a real supported integration; a provider name in a profile is not a connection.

For a classroom or other group, a single human intention creates a separate exchange for each eligible recipient. Each exchange has its own permission check, context boundary, progress, and failure handling. A group view aggregates outcomes without exposing one recipient's private context to the others.

## Contact and bounded source validation, implemented October 5, 2026

Every profile-specific agent call reads current ownership before recording contact; resource membership, attachment, grant and version checks remain separate. Ordinary calls coalesce contact writes into thirty-second intervals. A conditional database update handles concurrent first contacts without moving `last_seen_at` backward. Explicit `connect_agent` always records contact and returns the profile's monotonic `contact_version` and timestamp. Human reads and routing never manufacture contact. Migration `0014_agent_contact.sql` adds the counter with zero as the default, preserving existing profile status and timestamps.

The connection dialog captures this counter before setup and checks for an increase afterward. This distinguishes fresh contact when timestamps tie or clocks retreat. Contact proves a call authenticated as the profile's owner; it does not attest a vendor, prove a room read, or start external execution.

Final shared-source validation drives primary-key lookups from the bounded, deduplicated source-ID list. Source state, current membership/profile attachment and export revision still share one final database read. Missing and foreign-room sources remain excluded; withdrawn titles remain redacted. The lookup no longer scans every source in the room.

The isolated Worker/D1 [measurement record](verification/agent-load-oct5.json) reports one contact write for ten sequential reads, versus ten in the previous revision. The compact room probe reads 282 D1 rows at both 250 and 1,000 seeded sources after the lookup change, versus 512 and 1,262 before it. These are synthetic local database-work measurements. They do not establish production capacity, native provider compatibility, admission/rate protection, or operational recovery.

## Unified setup and optional inbox previews, MCP 0.12.0

The human connection flow is shared by account setup, saved assistant cards and room setup. The authenticated account must match the displayed account; exact reads verify that the chosen profile is owned and active. Account setup reads only availability and the selected profile, without loading room contents or attaching the profile. Room setup retains membership-generation checks and adds the owned profile to that room. The profile's saved provider selects its installation recipe, avoiding an independent provider choice that can disagree with the profile. New profiles use a default name unless the person supplies one. Creation receipts and the pre-setup contact counter survive retries; choosing another assistant resets those records, and stale asynchronous results are ignored.

`read_inbox` retains its full projection by default, including the existing full-page cursor scope. The optional summary projection uses a separate cursor scope and selects compact task metadata, a 300-character body preview, full body length and a feedback-availability flag. It does not fetch the complete body or feedback into the response. The final query includes current ownership/revocation and grant eligibility. Summary guidance explicitly requires `read_task` for full instruction, current authority and relevant history before acting or reporting. Existing exact readers and retry rules remain in force; summaries do not grant authority.

The [MCP 0.12.0 local comparison](verification/inbox-projection-oct5.json) records four matched full/summary runs at 250 and 1,000 rows per collection, each with concurrency 1, 8 and 24 and 138 requests per mix. Twenty large-text inbox items changed from 341,114 to 36,422 response bytes, an 89.32% reduction for this fixture. Both warm projections used two SQL statements; summary name/ownership joins read 192 rows versus 170 for full. Full task/history retrieval, unique cursor traversal and identical write-retry receipts passed. The initial summary/1,000 run had a twenty-four-request wave of approximately fifteen-second reads; its original report is retained, and a repeat did not reproduce it. The cause is unknown. Local dispatch/serialization, synthetic identity and admission-queue exclusions prevent production latency or capacity claims.

Distributed admission protection remains unimplemented. Current Sites configuration declares D1 and MCP only; its exposed configuration tools do not confirm a provisioning path for a Cloudflare RateLimit or Durable Object binding. A local in-memory guard would bound only one isolate and cannot establish an account-wide limit. A production limiter needs a supported, verified deployment path and operational testing. No per-read D1 counter or fabricated binding is included in this release.

## Implementation sequence

1. Extract shared policy checks and typed commands while preserving current behavior and transaction guarantees.
2. Add agent-bound connections and explicit relationships. Verify that one connection cannot act as another agent and that revocation takes effect immediately for new operations.
3. Complete remaining retry coverage, including recoverable invitation issuance and reload-safe drafts, alongside relationship-wide stale-form protection. Validate a real external-client flow through authentication, instruction, feedback, and owner review.
4. Add durable delivery and one-to-many dispatch. Test duplicate delivery, retry exhaustion, partial group failure, and revocation between enqueue and dispatch.

Before broader release, also establish migration recovery, backups, request limits, rate limits, and useful operational monitoring. Model-assisted hosting can then use the same authorized commands; it must not bypass the backend's decisions.

## Invitation acceptance and recovery

New invitations retain the issuing owner ID, a hash of the random code, recipient email, allowed role and expiry. Issuance checks current ownership and membership inside the insert. Acceptance rechecks issuer ownership/membership, recipient email, role, unused state and database-time expiry while claiming the invitation. Membership insertion depends on this attempt successfully claiming it; the activity event depends on an actual new membership. Existing roles are never overwritten by accepting another invitation. All writes commit or roll back together.

A consumed invitation can return a minimal receipt to its original accepting user while that person still has membership. This read-only recovery uses account ID, permits later email/expiry changes, and cannot restore lost access. Unused legacy codes have no attributable issuer and require replacement; the migration does not infer an issuer or change existing memberships. Codes remain hash-only, so invitation issuance itself does not promise lost-response recovery.

## Membership lifecycle, implemented 2026-10-01

Human-only commands support leaving, owner removal of another person, and transferring ownership to an existing member. Owners must transfer before leaving. Reviews pin both the target membership instance and the space membership revision. New joins receive random membership keys; existing rows begin with a clearly legacy marker. A removed and later rejoined member cannot be affected by an earlier uncommitted review.

Each mutation conditionally inserts an immutable actor-bound, payload-hashed receipt, then changes ownership or membership, advances the space revision and records activity in one transaction. Departure additionally revokes both directions of grants involving the departing person's profiles and detaches those profiles from this space. Every side effect is gated by the fresh receipt ID. A retry recovers the original minimal historical receipt even after the actor leaves; it cannot repeat cleanup or reverse a later ownership change.

Invitations record their issue-time membership revision. Admission checks it against the last departure of the authenticated account and the latest ownership transfer. Old invitations cannot undo a removal, including after an email change, and cannot revive when ownership returns to an earlier owner. Unrelated membership departures do not invalidate an invitation for someone else. A new invitation permits a deliberate rejoin with a new instance, without old attachments or authority.

Shared notes, exchanges and accepted guidance remain stored and shared with current members. The departing author loses source-management access and is told to review sharing before leaving. Private visits remain person-owned and closable; their live room-name lookup requires current membership. Agent context reads require a current owned active profile and attachment. Space reads recheck access and membership revision after collecting data. This is access lifecycle, not erasure, retention policy, recall of existing copies, or independently credentialed agent identity.


## Operational recovery rehearsal, 2026-10-01

`npm run verify:recovery` runs `tests/backup-restore.test.mjs` on isolated synthetic databases. `wrapDatabase()` binds the application to an already restored SQLite connection without creating tables or rerunning applied migrations. The fixture covers all 19 application tables. Workspace operations populate the original 16 tables, including revoked and replacement grants, withdrawn source content, two progress reports, three guidance decisions, removal/rejoin generations, immutable receipts, and open/closed private visits. The three provider tables use opaque synthetic records to check byte-preserving recovery; they do not represent decryptable real credentials or exercised provider authorization.

The rehearsal captures a whole database using [Node's SQLite backup API](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html#sqlitebackupsourceDb-destination-options), closes the source, copies the completed backup to a fresh destination and opens it independently. It compares all rows and schema objects before making application calls, requires successful integrity and foreign-key checks, and verifies owner boundaries, current guidance, source redaction, stale invitation rejection, changed-payload conflicts and receipt recovery without repeated effects. A separate older-schema fixture rolls back an injected migration failure, then applies only the remaining migration while preserving legacy data. The test runner records available and applied migration checksums separately, source fingerprints, capture time, Node version, backup checksum and table counts. Temporary connections close before temporary files are removed.

This is a local SQLite rehearsal with synthetic identities. It does not exercise D1's production backup transport, migration ledger, OAuth, provider clients, a real operational restore, or recovery time and data-loss commitments. [Cloudflare documents point-in-time recovery](https://developers.cloudflare.com/d1/reference/time-travel/) and warns that its restore operation overwrites a database in place. That documentation does not establish operator access or a successful restore for this Sites-managed database. The currently exposed Sites tools provide bounded table reads, not a consistent database backup or restoration operation.

### Procedure before any production restoration

1. Identify the exact deployment, source revision, database binding, capture point and applied migration ledger. Establish the failure window and recovery target. Preserve the current state and access-change evidence before replacing anything.
2. Establish and verify an incident access barrier for both human and agent traffic. Keep the recovery target isolated from clients and outgoing integrations. An application banner alone does not stop API access. An exercised barrier is still an open operational requirement.
3. Obtain a provider-supported consistent export or recovery point through an authorized operator. Keep it in controlled storage. Do not assemble a backup from separately paginated table reads, copy an actively written database file, or recreate records through creation APIs.
4. Restore into an isolated target and verify the complete schema, migration ledger, integrity, foreign keys, membership/ownership, grant status, source state, current guidance and all historical receipts. Test with authorized synthetic accounts; do not log real source bodies or private visit content.
5. Reconcile changes after capture before any traffic resumes: membership removal, ownership transfers, invitations, profile disconnections, grant revocations/expiry, withdrawn sources, guidance reconsideration and any erasure requests. Restoring old rows can resurrect access or withdrawn content. Retrying an operation whose receipt was lost can repeat an already-delivered effect. If the later state cannot be established, keep the affected access disabled and obtain fresh authorization; do not infer permission from the backup.
6. Test both allowed and denied paths against the proposed source/database pair. A code rollback alone does not roll back schema or data. Rehearse migration behavior on the restored target using the actual deployment mechanism; the local transaction test cannot establish D1 deployment rollback behavior.
7. An identified operational owner reviews the isolated evidence, unresolved data loss, access reconciliation, cutover and rollback plan. Only then reopen traffic, verify service health and denial cases, and record the incident outcome. Production operator access, secure backup storage/retention, recovery objectives, alerting and the access barrier remain unverified.

The third recovery case deliberately reproduces post-capture removal being absent from an older snapshot. Its passing result is evidence for keeping the target isolated, not evidence that an unrestricted restore is safe.

## Bounded agent admission and complete-text pages, MCP 0.13.0

The MCP transport now applies an in-memory, no-queue fuse independently in each Worker isolate: at most 16 concurrent body reads, 12 authenticated/tool calls, 3 calls per authenticated account and 2 potentially large reads. Large reads include full/default inbox, accepted context, task/guidance history, room lists and private session lists. Known invalid origin, content type or protocol headers are rejected before body parsing. Uploads keep the 128 KiB byte cap and have a five-second total deadline; incoming chunks do not reset it. Cancellation is requested without awaiting an uncooperative source.

A tool slot is claimed before fresh identity resolution; account fairness follows that resolution using the authenticated account ID. Slots cover actual work and response serialization and are released once in `finally`. Disconnecting does not free a dispatched tool's slot while its database operation continues. Overflow returns HTTP 429 with `Retry-After: 1` and `Cache-Control: no-store`, preserving a parsed request ID. Rejected calls are not queued or replayed automatically. Clients must wait and retry original arguments and request references. Public discovery avoids tool/account budgets, while body saturation can reject it too. No authorization cache, idle identity registry or D1 quota writes are introduced.

Large agent pages target one MiB for the duplicated MCP JSON response, including escaped text, structured data and a reserve for the input-bounded request ID/envelope. A bounded indexed metadata query sizes at most the requested limit plus lookahead in D1; a second query fetches only selected complete records under current access predicates. This adds a statement per full page and SQL JSON sizing work, while avoiding transfer and Worker hydration of unseen large bodies. The final inbox query evaluates grant expiry with a fresh timestamp. Changed selected IDs, ordering, revision or access cause a recoverable conflict. Exact reader authorization checks remain in place.

Pages preserve full text and original cursor scopes. A requested limit is a maximum; byte budgeting may return fewer records and continues after the last returned record. Task/guidance history, accepted context, full inbox, room lists and private session lists use this path. Human pages and compact summary polling retain their existing behavior. Intrinsically oversized legacy records remain whole and are marked `oversized_record`; this is not an unconditional byte ceiling for arbitrary old data.

Agent routing also summarizes the room's six accepted-guidance previews rather than duplicating their full wording and reasons beside the room catalog. Each preview retains its identifier, scope, version, timestamp and source provenance, with an explicit direction to retrieve current complete guidance through `read_context` or `read_context_change`. Human routing retains full guidance. A maximum escaped-text local fixture with twenty room purposes, six guidance records and a nearly 128 KiB request ID fell from 1,429,935 bytes for the previous projection to 807,177 bytes. That is a synthetic response measurement, not production capacity evidence.

These bounds are engineering policy, not proven production capacity or memory safety. Independent isolates share no counters; returned response bodies can still be draining after handler completion. A distributed limiter, production load/recovery testing and native client exchanges remain open. Current hosting configuration still does not provide a verified distributed binding path.

## Candidate-first sizing, actor preconditions and diagnostics, MCP 0.13.1

`largeAgentPage` now materializes a limit-plus-lookahead set of currently authorized IDs, ordering fields and revisions before applying JSON byte sizing to those candidates. This avoids evaluating large text for every improving sort candidate. Both metadata passes share one statement snapshot and one clock/binding set; exact record retrieval still uses fresh access/expiry predicates and verifies the selected IDs/order/revisions. The adversarial 1,001-room fixture sizes 21 records for a limit of twenty, compared with 1,001 evaluations in the prior projection. Eligible-room metadata scanning and temporary sorting are still present. Statement count and wire/cursor contracts are unchanged; no migration or speculative index was added.

Human requests may supply an `expected_owner_id` argument or `X-Accord-Expected-Owner` header as a precondition, compared to the freshly authenticated Workspace owner before domain SQL. Neither supplies identity or grants access. Session retries keep their original account and request receipt; session-list paging and room-opening checks pin the loaded account without adding it to URLs. Supplied mismatches or malformed pins fail; omission keeps older clients compatible. HTTP-route tests reproduce account changes between bootstrap, mutation and saved-room reads with no unintended room creation or invitation redemption.

MCP diagnostics add an independently generated `X-Accord-Request-Reference`, allowlisted method/tool/outcome/reason labels and observed body/auth/tool/serialization intervals. This reference is unrelated to caller retry keys. Samples and counters occupy fixed-size isolate-local state; the default observed-minute caps are two success, eight failure and four overload samples. The next completion after an elapsed window emits its aggregate summary. There is no timer, background flush, identity registry or diagnostic D1 write. Events omit identities, arguments, content, caller IDs/keys, URLs and exception details. Cleanup runs before best-effort emission, and diagnostic failures cannot change tool responses or hold admission leases. Observed timings are runtime intervals, not CPU or database-only measurements. Isolate termination may lose unflushed counts; native log delivery, retention, alerting and distributed service monitoring are separate operational checks.

The [October 6 recovery/agent evidence](verification/session-recovery-agents-oct6.json) retains exact source hashes, synthetic HTTP/browser scope, Workerd/local-D1 results and remaining production limitations.
