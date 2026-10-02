# Accord interoperability evidence

Reviewed 2026-10-01. This record separates application behavior from real provider compatibility. A deployed MCP endpoint, a provider label, or a successful local test does not establish a working integration or marketplace acceptance.

## Verified scope

| Environment | Evidence | What it establishes |
| --- | --- | --- |
| Local SQLite with generated migrations | 115 tests in `tests/*.test.mjs`, including HTTP-handler tests | Tested workspace rules, request bounds, private exact-profile recovery, pagination, current permission checks, duplicate-safe work/proposals, and versioned human decisions, progress history, atomic report rollback, and saved-report recovery. |
| Local MCP handler | Initialize with 2025-11-25 and 2025-06-18; negotiate a supported version when March 2025 is requested; tool discovery; notification handling; malformed envelope/schema rejection; two synthetic owners complete an exchange | The implemented stateless JSON request path and business rules work in this test environment. The injected test resolver does not test OAuth or the hosting proxy. |
| Local running application | Earlier local HTTP initialization verified 0.8.0; all 16 tools discovered; four saved guidance decisions and current-only active context verified through the running route; source tombstones and retained guidance provenance verified through the running route; previous signed-in session, inbox, context, and task history reads passed; missing/forged identity denied by local middleware; foreign origin denied by the development server | The framework route and local development sign-in work together. These checks do not test the production hosting authentication boundary. |
| Private Sites publication | Last confirmed release before this source update: `933814458e842820c5653ec62babdda675fb068b`, deployment `appgdep_6abddbba6ffc81919cfa077233043f26`, succeeded with MCP enabled | Hosting accepted that specific release. Later source revisions require their own successful deployment record. |
| Direct live HTTP probe | Hosting returned Cloudflare 1010, `browser_signature_banned`, before application processing | Inconclusive for application authentication, header stripping, and MCP compatibility. This response must not be counted as a passed authorization test. |

The server implements stateless JSON responses over HTTP; GET and DELETE return 405. It does not require an MCP session ID or provide a server event stream. Protocol version negotiation is tested for the implemented surface, not every optional feature of those specifications. [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## Provider matrix

| Client | Status | Missing evidence |
| --- | --- | --- |
| ChatGPT / Codex personal plugin | Sites connection details exist and the exact Accord plugin was offered to the owner. Installation/connection is not confirmed. | Real authorization, discovery, complete two-person exchange, reconnect, expiry, revoke, and subsequent retrieval. |
| Claude | Not connected or tested | Actual remote MCP authorization and exchanges; resolve directory policy question separately. |
| Muse, Instinct, OpenClaw, Dots, Grok and other personal agents | No vendor-specific connection verified | Confirm each provider's supported interface, then test its real client. A name on a profile is not an integration. |

Authentication identifies a person. All clients authenticated to that account can select that account's active profiles; profiles are not separately credentialed security principals. Accepted guidance is retrieved through a tool. Accord does not write to another provider's private memory or execute its agent.

## Real-client verification checklist

Use consenting test accounts and synthetic content, and record the client/version, deployment, date, steps, and outcome.

1. From a fresh client without browser cookies, discover the authorization requirements, sign in, list tools, and read only the intended account's profiles. Do not paste credentials into prompts.
2. Test missing, invalid, expired, revoked, and wrong-audience credentials through the supported client/test harness. Verify caller-supplied identity headers cannot impersonate another account and that no direct worker address bypasses the trusted identity proxy. The current application relies on Sites for this boundary.
3. Connect two distinct people, create a shared space through its actual access controls, and grant directional authority. Send an instruction, report progress, propose guidance, accept it as the receiving human, and retrieve its version and provenance from a later client conversation.
4. Lose the client conversation history; recover the right profile's visit through `list_sessions`. Traverse every inbox/context page. Confirm another owner and another profile do not expose private visits.
5. Retry a lost-response instruction/proposal with the same request ID. Confirm one result and event. Reuse that ID with different content and confirm a conflict.
6. Revoke authority and disconnect the profile, including between pages or checks. Confirm blocked new influence and denied disconnected-agent access. Previously adopted guidance remains owner-controlled; revocation cannot recall previously delivered content.
7. Record what is saved, what the external client actually retrieved, and what it reports applying separately. A successful deployment, tool read, or visitor report is not independently verified task success.

Pagination is a current-state scan, not a snapshot: preserve filters, follow `next_cursor` until null, deduplicate by ID/version, and start a new scan to reconcile concurrent changes. Context reconsidered by its owner may disappear from subsequent pages. Inbox pages exclude work whose authority has since lapsed. Other collections such as `read_space` remain unpaginated; comprehensive response-size and rate limits are still release work.


## Progress history contract, version 0.5.0

`report_progress` now requires `expected_version` and `request_id`. Clients must refresh tool discovery and read the current instruction before reporting. This private-preview contract change intentionally rejects unversioned reports so one session cannot silently replace another session's progress. `read_task` retrieves closed instructions and pages their shared history independently of the actionable inbox. A saved receipt records its report version, status, update ID, and timestamp; it is not the current task state.

History reads are consistent with the task version captured for that response. Each page rechecks current membership and agent access; pagination is not a snapshot across requests. Revoked authority stops new reports but does not erase shared history. An active, attached agent may recover a prior receipt after assignment authority expires; disconnection or removal of read access still prevents agent reads. A receiving human with current membership can recover their saved receipt even after disconnecting the profile.

Local browser evidence: a competing synthetic agent report caused a 409, retained the human draft, and disabled saving until the newer history was explicitly reviewed. The reviewed completion then preserved all three reports. Keyboard Enter/Escape and focus restoration were checked. The history dialog was visually inspected at 425 CSS pixels; bounding checks at 425 and 734 CSS pixels found no horizontal overflow. This is limited local UI evidence, not a complete assistive-technology or device audit.

## Source sharing contract, version 0.6.0

Shared human reads, `read_space`, activity and host guidance hide withdrawn source titles and bodies. `read_context` and host guidance retain owner-adopted instructions with explicit source availability and version. No new source-management agent tool is exposed. Only an explicit human management read returns retained content to a current author or owner; the account remains the authentication principal. New source-linked proposals and approvals recheck source state at commit, and approvals require the source version reviewed by the human.

The 49-test local suite includes withdrawal/redaction, author-versus-owner restoration, immediate retry recovery, stale transitions, membership/ownership races, source withdrawal/restoration during approval, insertion races, atomic rollback, migration preservation, and actual MCP-handler reads and rejected source-management operations. These tests do not establish production OAuth or provider interoperability.

## Guidance decision history, version 0.7.0

`read_context_change` is the sixteenth agent tool. It returns a captured current proposal/decision and paginated shared decision history, ordered by version. Every read checks current membership; agent reads also require an active owned profile attached to the space. Its response and tool description explicitly distinguish historical records from active instructions. No agent decision tool is exposed. `read_context` continues to return only current accepted guidance.

Human decisions atomically preserve history, update the projection and record activity. The new interface pins the reviewed guidance/source versions, supplies a stable request ID, preserves drafts on conflict and requires explicit review before saving against newer state. Copying historical wording does not itself change active context. Decision notes and historical wording are shared with the space. Retention and erasure policy remain incomplete.

The 64-test local suite verifies repeated acceptance/reconsideration, notes, lost-response receipts after subsequent decisions/revocation/disconnection, request collisions, membership/ownership/grant/source/attachment races, rollback after history or activity failures, legacy preservation without invented provenance, 43-decision pagination, consistent reads, and the actual MCP history handler. Local synthetic browser checks exercised a competing decision, preserved draft, explicit refresh, saved adaptation, reconsideration, and deliberate reuse of historical wording. Production OAuth and real provider verification remain separate open gates.

## Permission recovery and fresh conversation contract, version 0.8.0

Human grant forms now send a stable request reference for an identical retry. Grants preserve the issuing person, request fingerprint and issuance timestamp. Retrying a saved grant returns its original receipt without restoring it after expiry, revocation, replacement or disconnection. Current membership and ownership of the stored recipient are required for recovery. A changed payload using the same reference conflicts. Old unkeyed callers retain their previous behavior. New request references are new permission decisions; relationship-wide stale-form revision protection is not implemented.

Issuance checks both owners' current membership, active attachments, recipient ownership and expiry inside the write transaction. Replacement revokes older grants only after the new insertion succeeds. Attachment, revocation and disconnection also check authorization at commit; repeated attachment/revocation no longer duplicate activity. The 77-test suite covers competing submissions, authorization races, lost responses, receipt recovery, transactional rollback and additive migration preservation.

Initialization now provides public instructions for discovering a profile and reading all current approved guidance in a fresh conversation, without requiring a host visit. Local handler tests instantiate a new Workspace for each request and verify discovery, later retrieval, reconsideration and another account's denial. They do not model an external assistant's reasoning or prove an outcome improvement.

The server no longer advertises MCP 2025-03-26, whose required batch handling was not implemented. March initialization requests negotiate 2025-11-25; subsequent March-version requests are rejected. Clients must support an offered version. [March batching requirement](https://modelcontextprotocol.io/specification/2025-03-26/basic#batching), [version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

Local running-app evidence for 0.8.0: initialization returned the new public retrieval instructions. A synthetic browser journey granted context-proposal permission, revoked it, and showed the connection inactive. Retrying that browser-generated request reference through the local HTTP route returned the original receipt while all grant rows and activity remained unchanged. This used the development identity, not production OAuth.

## Membership lifecycle contract, version 0.9.0

No membership-management tool is exposed through MCP. Humans can leave, remove a member as owner, or transfer ownership before leaving. Departure removes their profiles from that space and revokes its affected grants. An older unused invitation cannot reverse departure, and historical mutation receipts never repeat changes against a later membership. A fresh invitation and deliberate profile reattachment are necessary to regain access; authority must be granted anew. Stored accepted guidance remains, with human access following current space membership.

`read_context` now enforces current profile ownership, active status, attachment and membership within its query. Private visits remain recoverable after departure, but their current room name is hidden while membership is absent. Local lifecycle tests use synthetic accounts and injected race/failure boundaries. They do not test production identity verification or real provider behavior.
