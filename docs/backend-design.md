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

Instructions and context proposals now support optional request IDs with payload fingerprints; tests cover identical retries and conflicts. Progress reports require a request ID and the reviewed task version; they append a record and advance the projection atomically with an activity event. Identical retries return the original report receipt, including after completion, while changed payloads or stale versions fail. Extend the retry pattern to other creation commands as needed. Scope request IDs to the authenticated actor and operation. Store a payload fingerprint and result: an identical retry returns the original result; reuse with different input fails. Commit the state change, history, and any outbox entry together.

Keep the pull inbox first. When automatic delivery is introduced, add a transactional outbox, bounded retries, delivery attempts, and a recoverable failed-delivery state. Design for duplicate delivery and recipient deduplication. Stop unauthorized pending delivery after revocation. Do not claim that revocation can recall information an external agent has already received.

## Context and privacy

The current context records preserve source provenance, the receiving owner's decision, and an incrementing approval version. Decisions reject stale versions and require current authority. Guidance decisions now append an attributable record, optional owner note and source-state snapshot in the same transaction as the current projection and activity. The new human review UI always supplies a request ID; legacy callers may omit it but then lack saved-receipt recovery. Identical keyed retries recover the original decision receipt after current membership and recipient ownership are checked, even if authority or source availability has changed. That receipt cannot reactivate old guidance. Only the currently accepted projection is returned as active context. Expiring a grant prevents new influence; it does not silently erase guidance already accepted by its owner. Owners must be able to reconsider adopted guidance.

Sources now have an active/withdrawn state and an incrementing version. A current member who is the author or space owner may withdraw a source; only the person who withdrew it may restore it while still authorized. The state update rechecks membership, management rights and version in the transaction. An identical immediately preceding transition returns the same receipt, but an older request cannot reverse a later decision. Loss of membership currently removes authors' ability to manage previously shared notes; departure and data-removal workflows remain open work.

Shared reads redact withdrawn titles and bodies; legacy source-sharing activity descriptions are generic because those events lack a source reference. Retained content is shown only by the explicit management read to an authorized author or owner. No agent tool exposes that read or mutation. This is a tool-surface boundary, not separate agent authentication: clients authenticated as the same person are the same security principal. Proposals must reference active sources at insertion. Acceptance also requires the reviewed source version to still be active at commit. Already adopted guidance remains intact and carries `source_status` and `source_version`; owners can reconsider it. Withdrawal does not erase derived text, provider copies, exports, retained storage, or backups, and is not a deletion policy.

Keep arrival purpose and departure reports private unless explicitly shared. Departures record what the visitor reported, not verified success. Record authorization decisions without copying private prompts or source bodies into operational logs. Define retention and deletion behavior before broader rollout.

## Interoperability and group participation

Retain MCP as the first transport. Future provider and A2A adapters must preserve identity, scope, provenance, and exchange state. Add adapters only against a real supported integration; a provider name in a profile is not a connection.

For a classroom or other group, a single human intention creates a separate exchange for each eligible recipient. Each exchange has its own permission check, context boundary, progress, and failure handling. A group view aggregates outcomes without exposing one recipient's private context to the others.

## Implementation sequence

1. Extract shared policy checks and typed commands while preserving current behavior and transaction guarantees.
2. Add agent-bound connections and explicit relationships. Verify that one connection cannot act as another agent and that revocation takes effect immediately for new operations.
3. Complete retry coverage, append-only exchange history, and creation-command retries beyond the existing exchange and decision safeguards. Validate a real external-client flow through authentication, instruction, feedback, and owner review.
4. Add durable delivery and one-to-many dispatch. Test duplicate delivery, retry exhaustion, partial group failure, and revocation between enqueue and dispatch.

Before broader release, also establish migration recovery, backups, request limits, rate limits, and useful operational monitoring. Model-assisted hosting can then use the same authorized commands; it must not bypass the backend's decisions.
