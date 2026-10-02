# Accord product quality plan

Reviewed 2026-09-30. Status: proposed requirements and evidence gates, not a completion report. Public research informs the plan; it does not establish demand, retention, security certification, or production readiness for Accord.

The goal is a dependable service people voluntarily reuse with their personal agents. It includes identity, permissions, exchanges, recovery, operations, support, and usable interfaces. Mentorship, onboarding, consulting, coaching, teaching, and other relationships should share the same foundations. A polished webpage alone does not meet this goal.

Read this alongside the [backend design](backend-design.md), [Space competitive assessment](space-competitive-assessment.md), and [directory readiness plan](directory-readiness.md). Space already overlaps shared context, collaboration, and agent guidance. Cross-provider relationship value remains a hypothesis to test.

## Research and design implications

The applications in the last column are Accord design judgments, not findings established by the cited sources.

| Primary source | Evidence and limits | Application to Accord |
| --- | --- | --- |
| [Google HEART, CHI 2010](https://storage.googleapis.com/gweb-research2023-media/pubtools/pdf/36299.pdf) | Goals–Signals–Metrics connects product goals to satisfaction, engagement, adoption, retention, and task success. It is a measurement framework with product examples. | Measure completed useful exchanges and later reuse; distinguish new from returning relationships and human activity from agent polling. |
| [Google latency experiments, 2009](https://www.research.google/blog/speed-matters/) | Injecting 100–400 ms of search delay reduced searches per user by 0.2–0.6%. This causal result concerns Google Search, not Accord. | Measure actionable load time and confirmed saves. Avoid adding delay for an unverified visual benefit. |
| [Amazon Working Backwards](https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes) | Firsthand operating philosophy: define customer benefit before implementation. It is not a controlled efficacy study. | Define what becomes easier than a shared page and manual transfer before expanding features. |
| [Amazon Buy It Again, KDD 2018](https://cdn.amazon.science/40/e5/89556a6341eaa3d7dacc074ff24d/buy-it-again-modeling-repeat-purchase-recommendations.pdf) | Randomized 14-day experiments reported a 7.1% recommendation-page CTR lift. Early recommendations drew negative beta feedback. Neither result proves long-term retention. | Help people resume recurring work when relevant; use their chosen cadence rather than manufactured urgency. |
| [Amazon editable personal profiles, 2026](https://www.amazon.science/publications/enabling-user-agency-in-scalable-content-recommendations-with-large-language-models) | Dataset experiments on MIND and Goodreads evaluate editable natural-language profiles and recommendation quality. They do not establish real-user retention. | Keep adopted guidance understandable, attributable, correctable, and owner-controlled. Portability alone is not unique differentiation. |
| [AWS idempotent API guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Production engineering guidance covers caller-scoped request IDs, atomic mutation, equivalent retry results, and changed-parameter rejection. | A lost response must not create duplicate work or uncertainty about whether an action succeeded. |
| [Robinhood visual identity, 2024](https://robinhood.com/us/en/newsroom/a-new-visual-identity/) | The announcement describes a simplified identity, focused palette, and modular layout. It provides design intent, not measured retention evidence. | Use Accord's own plain wordmark, restrained palette, and clear hierarchy; keep decisions and controls prominent. |
| [Coinbase accessibility, 2025](https://www.coinbase.com/en-ca/blog/how-accessibility-drives-product-quality-at-coinbase) | The engineering account describes accessible shared components, scalable text, multiple status cues, automated checks, and core-journey measurements. It is company-reported practice, not a controlled comparison. | Test complete journeys with keyboard and assistive technology; do not rely on color or automated scans alone. |

## The useful recurring loop

A person establishes a relationship and scope, connects an actually supported agent, exchanges relevant work or guidance, reviews the result, and returns when a new decision or task arises. Accepted guidance is available for a later task without repeating the whole conversation. The recipient can revise it and withdraw authority for future exchanges.

The return screen should explain what needs a decision, what changed, and what can be resumed. Completion should let people leave confidently. Do not optimize session length, require daily visits, invent activity, or send reminders without the user's chosen scope. Guidance retrieval is not proof it was applied, and agent-reported application is not independently verified success.

## Requirements and evidence gates

Keep each gate open until its evidence names the tested version, environment, date, result, and remaining limitations. Passing local tests establishes only their tested scope.

| Gate | Required behavior | Evidence needed before claiming readiness |
| --- | --- | --- |
| Useful first and second exchange | Two distinct people complete setup, permission grant, instruction or proposal, recipient review, feedback, and later reuse. | Observe the complete journey on real tasks. Record assistance, abandonment, repeated explanation, and the concrete benefit over the Space/manual baseline. |
| Provider interoperability | Claimed clients authenticate the intended person or agent connection and preserve permissions through actual tool calls. | A dated client matrix covering sign-in, discovery, exchange, review, subsequent read, token expiry, disconnect, and denied access. Muse, Instinct, OpenClaw, ChatGPT, and Claude each require their own result; a profile label is insufficient. |
| Privacy and authority | Recipient grants control new influence; shared sources and private visits stay within their boundaries. Concurrent changes cannot bypass current authority. | Review the trust boundaries and run two-user, cross-profile, cross-space, invitation replay, expiry, revocation, and stale-approval scenarios. No unresolved unauthorized read/write finding. Retention, export, deletion, and credential handling must match the published explanation. |
| Retry and recovery | Duplicate submissions do not duplicate work. Conflicting retries fail clearly. Failed requests preserve input and expose a safe next step. | Inject lost responses and interruption; retry identical and changed payloads; verify stored results and visible state. Exercise simultaneous reviews, expired sessions, disconnected profiles, and partial provider failure. Distinguish saved, delivered, and applied. |
| Accessibility and performance | Core controls remain understandable and operable across input methods, screen sizes, loading, empty, error, and success states. | Complete the loop with keyboard and screen reader; inspect focus, labels, zoom, contrast, reduced motion, and non-color status cues. Record automated findings plus manual results. Measure p50/p95 actionable-home and save latency on stated devices/networks; set and verify budgets before broader beta. |
| Operations and support | The team can detect failures, recover data, and answer access or privacy problems without collecting unnecessary private content. | Restore a backup into an isolated environment; rehearse migration recovery and rollback. Name an operational owner, recovery objectives, support channel, and response expectations. Verify monitoring for availability, latency, failed exchanges, and authorization anomalies without logging credentials or private source bodies. Test an alert and incident response. |
| Directory and public release | Listing language, legal/support material, tools, authentication, and review access describe the actual service. | Complete the linked directory plan, resolve Claude's context-instruction policy question, test each client, and supply repeatable reviewer scenarios. Listing approval and compatibility must be evidenced separately; neither is implied by deployment. |

Security boundaries are release requirements, not engagement experiments. Revocation cannot recall information already delivered or silently erase guidance previously adopted by its owner. Current account-owned profiles must not be presented as independently credentialed agents.

## Research cadence and repeat-use evidence

Start with the five-pair pilot in the Space assessment. Agree each pair's real task and expected cadence before observing use. Conduct a short session at first use and a follow-up after the next relevant task; ask what changed, what was ignored, and whether they would choose Accord again without prompting.

Review findings weekly while iterating. Track activation at the first completed useful exchange and retention as a second useful exchange within the relationship's agreed cadence. Report cohort size and elapsed observation time, separating voluntary returns from prompted sessions, agent polling, retries, and demos. Pair behavioral records with perceived effort, confidence in permissions, and reasons for stopping. Collect only necessary metadata with a clear purpose.

Three of five pairs independently choosing another useful exchange is an initial investment gate, not statistically established retention. Continue observing subsequent cycles and different relationship types before generalizing. When usage supports controlled experiments, predefine the user outcome, safety guardrails, exposure period, and analysis; do not optimize clicks at the expense of informed review. A sufficient shared-page baseline is a reason to simplify the product.

## Current implementation: local verification on 2026-09-30

Release `fc34c68e0632194394f06b4ff50ad7bbb6c26938` adds the behavior below. Eighteen automated tests passed against an in-memory SQLite database using all generated migrations. This validates tested service boundaries, not Cloudflare operations or external-client interoperability. Local browser checks used synthetic preview records; no external agents ran those tasks.

| Change | Evidence and limits |
| --- | --- |
| Return-home queue | Owner-specific reviews, eligible work, open sessions, and accepted guidance. Browser journey: open review from home, adapt and accept, return to adopted guidance; complete work and verify it disappears from attention. Local refresh retains the saved state. Automated checks exclude other owners and inactive work. |
| Duplicate-safe instruction and proposal requests | Optional caller request IDs and payload fingerprints are persisted atomically with the exchange. Browser forms retain their ID during an identical retry. Tests cover lost-response retry, changed-payload conflict, and a competing insertion before commit: one record and event. Other creation flows do not yet share this guarantee. |
| Versioned approval guard | Receiving-owner decisions require the version reviewed. Tests verify stale or missing versions cannot overwrite a newer adaptation, including a change just before commit. UI refreshes after conflict and preserves the open form; adoption still requires current authority. This is a concurrency guard, not a full revision-history feature. |
| Close disconnected-agent sessions | Disconnect blocks agent calls. The human owner can inspect a restricted private session, record its outcome, and close it; disconnection does not automatically close sessions. Tests cover other-owner denial, identical close recovery, and conflicting replacement rejection. Browser verified disconnect → close → new session without inheriting the revoked profile. |
| Consistent authorization | Actionable reads, home, host guidance, and conditional exchange writes account for both agents' current membership and attachment. Tests remove membership or attachment between initial checks and commit; no unauthorized exchange/event succeeds. |
| Bounded requests and recoverable failures | Browser requests have a timeout and preserve open-form input. API readers enforce byte caps while streaming and cancel excess bodies. Tests cover split UTF-8, misleading length, early cancellation, and maximum multilingual/escaped source text. Errors use no-store and diagnostics omit request contents. |
| Discoverable session history | Private sessions have cursor pagination, with open sessions queried separately. Sixty-six owner sessions remain retrievable without omissions or duplicates; another owner's session remains excluded. History pagination is not a bound on every workspace collection. |

TypeScript checking and the production build passed. The UI was inspected at phone (393 CSS pixels) and desktop (1028 CSS pixels) layouts without horizontal overflow, and keyboard activation was exercised for opening and accepting a review. Full screen-reader testing, performance budgets, provider verification, backup restoration, monitoring, and observed repeat use remain open gates. The earlier migrations remain unchanged; migration 0002 only adds nullable request fields, unique indexes, and a constant-default approval version.

## Delivery order

Next prove one external-client journey and its failure paths, complete recovery/support preparation, and run the observed pilot. Use that evidence to prioritize the next relationship or provider capability. Broader launch requires the operational and directory gates as well as usable core journeys; sustained voluntary return requires evidence collected over time.

Release `fc34c68e0632194394f06b4ff50ad7bbb6c26938` was published privately on 2026-09-30. Sites confirmed deployment `appgdep_6abdbe47d7d88191b4c1c9390c6ab345` succeeded with MCP enabled. The missing packaging helper was worked around by validating the build archive against the previous successful format; no access policy was changed. Publication confirms deployment, not provider interoperability.

## Subsequent agent recovery verification

The source revision containing this section passes 25 automated tests across the workflow, request-body, and actual MCP HTTP handler suites. Tests recover 61 exact-profile sessions, retrieve all 121 open inbox items across pages, read 61 approved guidance records with versions, and apply current authorization and decisions between pages. Invalid JSON-RPC IDs and invalid tool schemas cannot reach the service; tool-shaped notifications cannot dispatch writes. An in-memory two-owner exchange exercises the real handler through arrival, session recovery, duplicate-safe work, progress, proposal, human approval, subsequent context retrieval, and revocation. This is local contract evidence using synthetic identities, not a real provider or production OAuth test.

The [interoperability record](interoperability.md) separates these checks from the remaining external-client and infrastructure checks. Live publication of any subsequent revision must be confirmed by its own Sites deployment record.


## Progress history verification, 2026-09-30

The source revision containing this section passes 37 automated tests. Progress reports now append attributable records and advance a task version within the same transaction as the task projection and activity event. Tests cover identical and competing retries, changed request payloads, stale versions, closed tasks, current authority at commit, cross-account/profile access, paginated history, migration preservation, and rollback after an injected history-insert failure. A read-race regression verifies that the displayed task and returned history refer to a consistent version.

Migration 0003 adds a table, two unique indexes, and a constant-default task version. It does not rewrite earlier migrations or backfill an unbounded dataset. Existing feedback remains readable as an explicitly unattributed legacy snapshot; the first later report preserves that snapshot atomically before updating the task. Feedback already overwritten in the older implementation cannot be recovered.

The local browser journey used synthetic records: open a report, receive a competing agent update, reject the stale submission while retaining its draft, review the newer history, save a completion, and inspect all three reports. A focus-restoration issue found during keyboard testing was corrected and verified. The new history interface preserves the existing restrained visual direction. Real provider authorization, operational recovery, full accessibility/performance evidence, privacy lifecycle, and observed voluntary reuse remain open gates.

## Shared-source control evidence, 2026-09-30

Reversible source withdrawal now hides source titles/bodies from ordinary shared reads, including legacy title-bearing activity and agent/host reads. Restoration belongs to the person who withdrew the source while still a current authorized member. Both state transitions and guidance acceptance have optimistic version guards; proposals require an active source at commit. Previously accepted guidance is preserved with an availability marker so its recipient can reconsider it.

The local suite now contains 49 tests, including source authorization, redaction, competing and stale transitions, source state/version races, rollback and additive migration preservation. Withdrawal retains source storage and leaves existing copies, derived text and adopted guidance intact. Data erasure, retention duration, backups, member departure and support requests remain unimplemented privacy-lifecycle requirements. This is progress on control, not completion of the privacy or production-readiness gate.

Browser review with synthetic local records exercised stop sharing, restoration, and a second withdrawal. The shared list displayed a tombstone; pending acceptance/adaptation became unavailable while accepted guidance kept its warning and reconsideration control. Escape returned focus to the source row. A 425-pixel-wide viewport showed no horizontal overflow in the source dialog. Local HTTP verification reported MCP 0.6.0 with the same 15 tools and confirmed shared-source redaction. Browser clipboard retrieval returned an empty value in this environment, so clipboard export content was not independently verified through that API. The export uses the same source-availability label visible on guidance cards.

## Guidance history evidence, 2026-09-30

The 64-test local suite now covers an immutable guidance-decision history alongside its current-state projection. Owner decisions retain the accepted wording, optional decision note, actor, version and source availability at the transaction boundary. A saved keyed receipt can be recovered without repeating or reactivating a decision. Old unkeyed callers retain version protection but do not receive keyed receipt recovery.

Migration 0005 only adds the history table and unique indexes. Existing decisions are preserved lazily as the one surviving legacy state, with unknown historical actor/source state; decisions already overwritten cannot be reconstructed. Ordinary pending proposals at version zero do not acquire fabricated decisions. Shared history remains distinct from active instructions, including through the new agent read tool.

Synthetic browser verification covered a competing decision while a draft was open: stale save rejected, wording and note preserved, explicit refresh required, and the draft saved as a later decision. Reconsideration removed active wording while preserving history. Copying prior wording focused the draft and did not alter stored state until a new save. A card-remount focus issue found in that journey was fixed; focus returned to the review control after save. The history dialog was inspected at desktop and 425-pixel widths with no observed horizontal overflow. This does not replace full screen-reader, performance, production-client, operational, or observed-retention evidence.

## Permission recovery and connection guidance, 2026-09-30

The 77-test suite adds lost-response and competing-grant recovery, changed-content conflicts, commit-time membership/ownership/profile/attachment checks, rollback of issuance and replacement, and migration preservation. Retrying an earlier grant cannot restore revoked authority or revoke a newer grant. Repeating attachment or revocation produces no duplicate activity. This covers these operations; create-space/profile/source retries and relationship-wide stale-form protection remain separate gaps.

The public connection manifest and MCP initialization now explain how a fresh conversation can select its intended owned profile and retrieve current approved guidance with pagination, scope and provenance. Local handler tests verify the path across fresh service instances and owner reconsideration. Real assistant execution, supported-provider OAuth and voluntary later reuse remain unverified. This work makes a real pilot more testable; it is not evidence that the pilot's product hypothesis has passed.

## First-use recovery evidence, 2026-09-30

The 97-test suite covers retry-safe creation of spaces, profiles and sources, plus atomic invitation issuance and acceptance. Receipts are bound to the authenticated creator, operation and normalized payload. Current access is required to recover them; retries cannot reconnect profiles, restore source sharing or recreate membership. A concrete overlapping-join race that could restore removed membership was reproduced and fixed. A second preflight interleaving now recovers the winning same-user join instead of reporting a false failure.

Migration 0007 adds a receipt table and nullable invitation issuer without rewriting prior migrations or inventing historical provenance. Unused legacy invitations require replacement, while existing memberships and eligible consumed-code receipts remain available. Invitation issuance cannot recover a lost plaintext code because codes are stored only as hashes. Form request IDs are retained while the form is open; reload-safe drafts remain unimplemented.

Local browser fault injection verified create-success/attachment-failure, repeated attachment retry without duplicate creation, successful attachment to the same saved space, and Escape dismissal with the saved space already visible on home. A failed setup now focuses its retry action. These checks use synthetic local records; they do not demonstrate production OAuth, real provider interoperability, external-agent application or observed repeat use.

## Membership lifecycle evidence, 2026-10-01

The local suite contains 115 tests after adding departure, owner removal and ownership transfer. Checks cover current authorization, membership-instance and space-revision races, historical receipt recovery after later changes, new admission after rejoin, old invitation barriers across email and ownership changes, unchanged unrelated-space access, and atomic rollback at each write stage. Additional read guards prevent detached/disconnected profiles from retrieving accepted context and hide current room names from former members' private-session lists.

Synthetic local browser verification covered a participant leaving during an open removal review, rejection with saving disabled until review, the refreshed absent membership, successful owner removal, transfer to an existing member, and the former owner's departure. Focus moved to the people heading after removal/transfer and the spaces heading after departure. Stored records confirmed the new owner, revoked grants, no remaining attachments in the test space, and retained shared notes. Desktop review passed. An attempted narrow viewport override left the measured viewport at 1265 pixels, so phone layout was not verified in this pass.

Migration 0008 adds an immutable receipt table and constant-default membership/admission fields without fabricating historical departures. Shared records and existing memberships remain. Account deletion, retention duration, backup restoration, production operations, full accessibility/performance evidence and real provider use remain open.

The next evidence gate is one real authenticated client retrieving reviewed guidance in a fresh later conversation against a named deployed version, followed by a second provider and voluntary reuse. Local reliability checks cannot substitute for that evidence.
