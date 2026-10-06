# Accord interoperability evidence

Reviewed 2026-10-01. This record separates application behavior from real provider compatibility. A deployed MCP endpoint, a provider label, or a successful local test does not establish a working integration or marketplace acceptance.

## Verified scope

| Environment | Evidence | What it establishes |
| --- | --- | --- |
| Local SQLite with generated migrations | 137 tests in `tests/*.test.mjs`, including HTTP-handler and synthetic Granola provider tests | Tested workspace rules, request bounds, private exact-profile recovery, pagination, current permission checks, duplicate-safe work/proposals, and versioned human decisions, progress history, atomic report rollback, saved-report recovery, and the [Granola connection contract](provider-integrations.md). No real Granola account was used in these tests. |
| Local MCP handler | Initialize with 2025-11-25 and 2025-06-18; negotiate a supported version when March 2025 is requested; tool discovery; notification handling; malformed envelope/schema rejection; two synthetic owners complete an exchange | The implemented stateless JSON request path and business rules work in this test environment. The injected test resolver does not test OAuth or the hosting proxy. |
| Local running application | Earlier local HTTP initialization verified 0.8.0; all 16 tools discovered; four saved guidance decisions and current-only active context verified through the running route; source tombstones and retained guidance provenance verified through the running route; previous signed-in session, inbox, context, and task history reads passed; missing/forged identity denied by local middleware; foreign origin denied by the development server | The framework route and local development sign-in work together. These checks do not test the production hosting authentication boundary. |
| Private Sites publication | Functional code published at `0bb2404b8a95b566c5d9a7e73702bcff0841d814`; acceptance documentation published at `2594f50d14ec058bb0cd5f8e3a1d127447e92f50`, deployment `appgdep_6abeae685ca0819181f06e53be5f16f1`, succeeded with MCP enabled | Hosting accepted that specific release. The October 1 live browser checks below ran against that publication. Later source revisions require their own successful deployment record. |
| Production Chrome, one real owner | Normal ChatGPT sign-in followed by profile/space setup, directional permission, an instruction and report, adapted guidance, reload/retrieval, and cross-tab stale-form rejection after revocation | The hosted human workflow worked for this synthetic scenario under the owner's real account. This does not establish MCP authorization, two-owner isolation or external agent execution. |
| Production Codex, installed Accord plugin, one real owner | Authenticated tool discovery and calls on source `9574adcc13d94e6f2c116cb6344a18fd3310ff63`; work, progress, pending/adapted guidance, fresh isolated assistant retrieval/application, identical retries, changed-content conflict, reverse-direction/revoked-grant denials and disconnected-profile read denials | The live plugin exchange works in this bounded synthetic scenario. Both profiles belong to one account; this does not establish two-owner isolation, another provider's compatibility, default guidance reuse or better real-world outcomes. See the live MCP evidence below. |
| Direct live HTTP probe | Hosting returned Cloudflare 1010, `browser_signature_banned`, before application processing | Inconclusive for application authentication, header stripping, and MCP compatibility. This response must not be counted as a passed authorization test. |

The server implements stateless JSON responses over HTTP; GET and DELETE return 405. It does not require an MCP session ID or provide a server event stream. Protocol version negotiation is tested for the implemented surface, not every optional feature of those specifications. [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## Provider matrix

| Client | Status | Missing evidence |
| --- | --- | --- |
| Codex, installed Accord plugin | Real authenticated tool discovery and a complete synthetic work/guidance exchange verified on 2026-10-01 for one owner and two profiles. Revocation and disconnection denials verified. | Complete two-person exchange, live credential-boundary abuse tests, expiry, reconnect and voluntary reuse. Exact client version was not recorded. |
| ChatGPT personal plugin | Private Sites plugin provisioned; no live ChatGPT assistant exchange verified. The Chrome directory was in a different organization context. | Actual assistant authorization, discovery and exchange in ChatGPT. Codex evidence does not establish this client. |
| Claude | Not connected or tested | Actual remote MCP authorization and exchanges; resolve directory policy question separately. |
| OpenAI dots | Actual existing dot used Accord MCP to discover/connect its profile, read its room and inbox, and save a completed version 1 reply to consumer Muse's task on 2026-10-05. See [pilot result](dots-pilot.md). | Guidance review and subsequent reuse, independent-owner isolation and automatic invocation remain unverified by this exchange. |
| Granola | Real OAuth start/dynamic registration verified on the private Site; private previews and selected imports implemented and tested with a synthetic provider | Confirm human consent/callback, account/workspace access, actual tool schemas, a selected notes import, expiry and disconnect. No continuous sync. See [provider evidence](provider-integrations.md#local-evidence-and-next-live-check). |
| Meta Muse | Actual consumer Muse assigned a task through authenticated local Chrome and read the dot's saved version 1 answer back on 2026-10-05. The temporary work-only grant was revoked. | Native Muse MCP authorization/calls and provider attestation remain unverified; the browser exchange used one human account and manual invocation. See [Muse setup record](muse-connection.md). |
| Instinct | Official personal assistant identified; dedicated setup dialog, profile selection and conditional verification prompt prepared | Inspect its supported integrations and verify actual authorization and calls. No custom MCP support or real connection established. See [Instinct setup record](instinct-connection.md). |
| OpenClaw, Grok and other personal agents | No vendor-specific connection verified | Confirm the intended provider and supported interface, then test its real client. A name on a profile is not an integration. |

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


Recovery/accessibility update: three additional local recovery cases bring the suite to 118. They test SQLite backup restoration and application behavior using synthetic identities; they do not change the MCP 0.9.0 contract or verify any additional client. This update was published as source `0bb2404b8a95b566c5d9a7e73702bcff0841d814`, deployment `appgdep_6abeac8f6bd481919001c3a3ef145b6f`, confirmed successful by its native deployment record.


## Functional POC acceptance path

Owner priority set 2026-10-01: functionality first, owner test/approval next, delivery format after approval, interface after that. Use the existing private prototype and its current protocol as test infrastructure. Testing one supported client does not commit Accord to that delivery format.

Latest confirmed functional source before this acceptance-path update: `0bb2404b8a95b566c5d9a7e73702bcff0841d814`; Sites deployment `appgdep_6abeac8f6bd481919001c3a3ef145b6f` succeeded privately with MCP enabled. All 118 local tests passed. Production sign-in, a real assistant exchange and owner approval are not established by that result.

Test with two consenting people and synthetic content. A second participant needs access to the private Site as well as an invitation into the shared space. The first real client should be whichever supported assistant the owner can connect now; confirm its actual authentication and tool discovery rather than assuming a profile label establishes integration.

| Step | Action | Observable pass condition |
| --- | --- | --- |
| 1. Identify participants | Both people sign in and connect their own assistant profiles. | Each client discovers only its owner's profiles. The exact client, version and deployed source are recorded. |
| 2. Establish a relationship | Create one shared purpose, invite the receiving person, and attach both profiles. | Both people see the same space and source. Another account is denied. |
| 3. Set direction | The receiving owner grants the sender permission to assign work and propose guidance with a stated expiry. | Allowed direction is visible; an ungranted reverse-direction operation fails. |
| 4. Exchange work | The sender's actual assistant sends a focused instruction; the receiving assistant retrieves it and reports progress. | One persisted instruction, attributable progress and recoverable history. Retrying the same request does not duplicate it. |
| 5. Review guidance | The sender proposes guidance with a reason and relevant shared source. The receiving person adapts and accepts it. | Proposal stays pending until the human decides. The accepted wording, source and decision version are inspectable. |
| 6. Resume independently | Open a fresh assistant conversation with no copied prior conversation and request the receiving profile's current guidance. | The actual client retrieves the current accepted version. Ask a concrete follow-up task and inspect separately whether it applied that guidance. A tool read alone does not prove application. |
| 7. Stop authority | Revoke the grant and ask the sender for a new instruction/proposal. Then disconnect a profile or remove its space access. | New influence is denied. Disconnected/removed profiles lose the relevant reads. Shared history and previously adopted guidance follow the documented ownership rules. |
| 8. Owner acceptance | Give the owner the URL, exact scenario, recorded results and any reproducible limitations. | The owner runs the POC and explicitly approves it. Do not infer approval from deployment, silence or test success. |

Suggested synthetic source: “Before selecting a queue, state the delivery guarantee, acceptable delay, expected volume, and what should happen after a duplicate message.” A test instruction asks the receiver to identify those assumptions for a sample notification service. A proposed lesson carries the reasoning into a future design task; the recipient can narrow or change it before acceptance. This is a test scenario, not an asserted integration or an externally sent instruction.

Record each step as passed, failed or not run, with actor, client, deployment, action, observed result and supporting receipt/error. Fix failures in this loop before expanding scope. A human manually operating both profiles is useful workflow evidence but does not satisfy the real assistant/two-owner steps. The POC does not claim autonomous waking, modification of provider memory, universal compatibility, production recovery, marketplace acceptance or proven retention.

Current live-test access: the owner explicitly authorized Continue with ChatGPT and completed sign-in in Chrome on 2026-10-01. Authenticated production browser access and actual installed-plugin calls from Codex are verified in the records below. No authentication workaround was used. A separate consenting account and the owner's POC approval remain outstanding. The private Site's audience has not been expanded.

## Production browser smoke test — 2026-10-01

Client: Chrome, normal signed-in owner session. Browser version was not recorded. Source `2594f50d14ec058bb0cd5f8e3a1d127447e92f50`, confirmed deployment `appgdep_6abeae685ca0819181f06e53be5f16f1`. These checks were driven through the visible human interface, with synthetic content and two profiles belonging to the same account. The existing `mentorship` / `Product design` space was not modified.

Created a separate `POC Verification · Oct 1` space, `POC Advisor · Oct 1` and `POC Recipient · Oct 1` profiles, and a `Synthetic queue design checklist` source. At the end of this browser-only test, both profiles were labelled `Awaiting connection`. The only test authority was Advisor → Recipient for work and guidance, with October 2 expiry; it was revoked at the end of this test. The subsequent live MCP test changed profile status as recorded below.

| Check | Observed result | Status |
| --- | --- | --- |
| Sign-in and setup | Real owner workspace loaded; both profiles, their space attachments, shared source, and the directional grant were saved. | Passed for one owner |
| Work and progress | Instruction `4ee2b769-7317-4408-837c-4fb69050c57a` saved, followed by one synthetic completed report. History read returned version 1, the exact report and personal attribution. | Passed through human UI |
| Pending guidance and adaptation | Proposal `01f58f02-9fca-4f2f-b0b4-b85716288364` stayed at For review / version 0 until explicitly saved through the human decision form. Wording was narrowed to notification-system design and accepted with a synthetic test note, producing version 1. | Passed through human UI |
| Reload and retrieval | Reloaded the page, reopened the space, and retrieved the saved task/report and exact accepted guidance, scope and source. | Passed for browser persistence |
| Revocation enforcement | Filled an instruction form while authority was active, revoked that authority in a second Chrome tab, then submitted the original form. The server response displayed “This authority has expired, was revoked, or does not permit this action.” A refreshed work list contained only the original instruction. | Passed for stale-form rejection |
| Retained guidance/history | After revocation, accepted wording remained at decision version 1. A fresh guidance-history read returned the note, personal attribution and source version 0. | Passed through human UI |

Evidence screenshots were saved locally at `/private/tmp/accord-live-guidance.jpg` and `/private/tmp/accord-live-revoked-instruction.jpg`; these are ephemeral visual evidence, not production backup artifacts. Synthetic records remain in the private test space for the owner to inspect. Nothing was sent to another person.

Not run at the time of this browser-only test: actual assistant MCP authentication/discovery/exchange, a separate consenting account, fresh assistant-conversation retrieval/application, agent-side revocation rejection and owner POC approval. The later live MCP test below covers some of these gaps. Browser-driven synthetic acceptance of guidance is not the owner's approval of the product. No implementation failure was found in this bounded browser scenario; it does not establish an issue-free system.

Historical connection follow-up: the Chrome ChatGPT plugin directory opened in the owner's Oracle organization workspace. Its Personal directory had no Accord entry, and the workspace menu exposed only that organization. The native Sites connection metadata still identified the existing private Accord plugin, and the supported plugin suggestion reported Accord available for installation or connection in the project's account. Installation was unconfirmed at that point. Connection instructions were clarified and published as source `9574adcc13d94e6f2c116cb6344a18fd3310ff63`. The existing plugin subsequently became callable in Codex; no replacement plugin or audience expansion was needed.

## Production live MCP exchange — 2026-10-01

Client: Codex desktop with the installed private Accord plugin; exact Codex and Chrome versions were not recorded. All 16 Accord tools became available in the assistant's actual tool inventory. Calls used the installed plugin's authentication, without injected identities, copied credentials, direct HTTP probes or browser cookies supplied to tools. The receiving review form was operated in Chrome. Source `9574adcc13d94e6f2c116cb6344a18fd3310ff63`, deployment `appgdep_6abeb85fc490819190c6209c5cd278d1`, succeeded privately with MCP enabled before these checks.

Both synthetic profiles belong to the same real account. `list_my_agents` returned that account's two profiles and `connect_agent` confirmed both. This establishes ordinary authenticated access for this owner, not isolation between real owners or resistance to forged, expired or wrong-audience credentials. The existing `mentorship` space was not modified.

| Check | Observable evidence | Result |
| --- | --- | --- |
| Existing data retrieval | Recipient `read_context`, `read_task` and `read_context_change` returned the original exact accepted guidance at version 1, source active/version 0, saved work and human-channel decision history. | Passed |
| Old revoked grant | A new instruction under the browser test's revoked grant returned `isError: true` with “This authority has expired, was revoked, or does not permit this action.” The recipient inbox was empty. | Passed |
| New live instruction | A new short-lived Advisor → Recipient grant, `16f371a0-cc60-43f7-9268-2b71f00f5b8d`, was saved through the human form. Advisor `send_instruction` created task `7c7e5b3c-1cea-43fc-a56b-d49ff7d76d66`; recipient `read_inbox` returned it at version 0 with agent attribution. An identical retry returned the same task ID. | Passed for one owner |
| Pending guidance gate | Advisor `propose_context_change` created proposal `13c50e28-7e4c-49fd-9615-31726e863cbd`. `read_context_change` returned pending/version 0 with no decision history and `can_decide: 0`; recipient `read_context` excluded the pending proposal. No MCP human-decision tool exists. | Passed |
| Wrong direction | Recipient attempted to send using the Advisor → Recipient grant. The result was `isError: true`, “This authority does not belong to the sending agent.” | Passed within one account |
| Fresh assistant retrieval/application | An isolated Codex subagent with no inherited conversation, copied guidance, browser access or repository reads discovered the recipient through the plugin and retrieved its approved guidance. In response to “Recommend a messaging tool for a new notification service,” it asked for delivery guarantee, acceptable delay, average/peak volume and duplicate handling before recommending a tool. At that time only the original guidance was accepted; `next_cursor` was null. | Passed for explicitly prompted retrieval/application in this client; not an independent owner or provider |
| Versioned progress and retry | Recipient `report_progress` saved completed/version 1 with update `3a21bd46-3a15-4863-889c-2a927bdceedf`, timestamp `2026-10-01T19:52:01.698Z`. An identical retry returned the same receipt, and `read_task` showed one update. The report described the synthetic fresh-assistant result rather than claiming a validated design outcome. | Passed |
| Adaptation and later tool retrieval | The browser decision form adapted and accepted the live proposal at `2026-10-01T19:54:03.394Z`, decision version 1. Recipient `read_context` returned the exact adapted wording below, active source/version 0. `read_context_change` recovered decision `25f8e7ee-bb56-40cd-8b84-71521adc3a3c` and its synthetic-test note. | Passed through an agent-operated human form; not personal owner review or POC approval |
| Changed-content request collision | Reusing the instruction request reference with different content returned `isError: true`, “This request reference was already used for different content. Start a new submission.” | Passed |
| Revoke new authority | The browser revoked the new grant. New MCP work and guidance both returned `isError: true` with the permission error above. Accepted context and completed task history remained readable by the active recipient. An identical saved-progress retry after revocation recovered the same original receipt without another update. | Passed |
| Disconnect profile | The browser disconnected the disposable Advisor profile. Advisor `read_space` and `list_spaces` each returned `isError: true`, “This agent is not available to your account.” The still-connected recipient retrieved both accepted guidance records with `next_cursor: null`. Shared history was retained. | Passed |

The adapted instruction retrieved through the real plugin was:

> For notification-system design, separate confirmed delivery, delay, volume, and duplicate-handling requirements from missing ones. Ask a focused question for each missing constraint before recommending a messaging tool.

Current test state: both test grants are revoked; the Advisor profile is disconnected; the Recipient profile remains connected; one browser-created task and one MCP-created completed task remain inspectable; two accepted guidance records remain. Disconnection is not a demonstrated reconnect flow: the current prototype does not offer restoration of that disconnected profile. A later sender test requires a new active profile. The guidance decision note explicitly says the browser-operated test is not the owner's approval of the POC.

Visual evidence was saved at `/private/tmp/accord-live-mcp-guidance.jpg` and `/private/tmp/accord-live-mcp-disconnected.jpg`. These local screenshots are ephemeral evidence, not durable backups. The live receipts above identify the persisted test records.

Remaining acceptance gates: two consenting real accounts, their private Site admission and actual space invitation, recipient-owned authority, each client's intended-owner discovery/reads, independent receiving-owner review, and explicit owner POC testing/approval. The owner has been asked whether to use a second account or a consenting partner; no participant has been invited and the private audience remains unchanged. Live credential abuse/expiry, reconnect, private visit recovery and multi-page concurrent scans remain untested. Other providers, autonomous waking, provider-memory changes, voluntary repeat use, token savings, outcome improvements, production recovery and marketplace acceptance are not established by this test. No implementation failure was observed in this bounded live scenario.

## Shared client packages and efficient reads, MCP 0.10.0

October 5: [Claude, Grok Bot and Muse packages](agent-plugins.md) now share the same authenticated service and generated tool inventory. Claude's private plugin and marketplace validate in the installed CLI. Grok's bundle is a marketplace candidate with a custom-server route, and Muse's bundle is a Custom Connector setup packet. None establishes live native OAuth compatibility. The previously proved Muse Chrome/dot exchange remains distinct.

Agent-created assignments and proposals now require retry references at the MCP boundary, preserving identical retries and rejecting changed submissions. Missing references do not resolve private identity or reach writes. Three additive pagination indexes remove temporary sorting work in the actual inbox, accepted-guidance and private-session query plans. Synthetic multi-owner regression checks preserve complete cursor traversal, isolation and revoked-grant filtering. This is database efficiency evidence, not a production load test.
