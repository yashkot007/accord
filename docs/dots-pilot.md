# Agent exchange pilot

Updated 2026-10-05. **PASS: actual consumer Muse created a task through Accord's website, the actual OpenAI dot read and answered it through Accord MCP, and Muse retrieved the saved reply from Accord. The temporary grant was then revoked.** The answer was not supplied to Muse outside Accord.

The initial plan was two test dots. The completed pilot used an existing personal dot and a Muse side chat/browser task under one Accord owner. No new dot or independently credentialed agent identity was created.

## Verified exchange

- Room: **POC Verification · Oct 1**, `c8752e73-414c-4fad-85ba-31f4cc81c0ca`.
- Sender profile: **My Muse**, `1ddf6c81-cfce-4d43-8ad8-ea14a9671f21`.
- Recipient profile: **POC Recipient · Oct 1**, `298a9896-344d-45bc-b2b9-470d9f895544`.
- Actual Muse conversation: [Accord browser access test](https://muse.ai/thread/f919e4af-39ae-47b4-a4bd-7c4ff63f8af0).

The owner explicitly authorized the scope. Codex applied My Muse's attachment and **My Muse → POC Recipient** assignment grant through the owner's signed-in UI: `allow_assign=1`, `allow_context=0`. The precise local expiry entered was **2026-10-05 20:10:16 America/Los_Angeles**. The dot's actual `read_space` returned the active grant and **2026-10-06T03:10:16.000Z**, matching that intended expiry.

1. Actual Muse used the website's **Assign work** control to save **Retry policy check · Muse pilot Oct 5**, a synthetic question about three immediate retries after failure.
2. The actual dot called `read_inbox`, found that task, and returned `next_cursor: null`. It generated its own three-bullet answer and called `report_progress` with the task's current `expected_version: 0`.
3. The saved result was **completed, version 1**. Chrome independently showed the same report in **Instruction history**.
4. Muse then read the persisted three bullets and completed version 1 through the website. Its readback matched the saved reply. The orchestrator did not send it the answer.

| Saved evidence | Value |
| --- | --- |
| Task ID | `e6ad183e-cd57-4409-9517-0866be312f21` |
| Report update ID | `c189a8eb-b043-4be0-88d2-a09530919206` |
| Report recorded at | `2026-10-06T02:22:17.069Z` — Oct 5, 7:22 p.m. Pacific |
| Report state | `completed`, version `1` |
| Report attribution | POC Recipient through its owner's authenticated connection |
| Exchange runtime | Private Site version `31`, `appgprj_6abc31f54d5881918f6d1a4d769864cd~appgver_fe9b647b46c08191aa74408e6c4096ef` |
| Exchange source | `aa5717d601d570e89b61538d3e56cb2af7f92ac0` |
| Exchange deployment | `appgdep_6ac4585aed988191bad606a11ed5b427` |

The feedback addressed retry storms and duplicate side effects, bounded retries for transient/idempotent operations with backoff and jitter, and a question about idempotency. The instruction is labeled **Submitted by a person** because Muse operated the website's human API. The reply's history has agent-channel attribution; the instruction label is not the reporter identity. Client evidence establishes the observed browser/MCP path, not cryptographic provider attestation.

## Cleanup verified

Codex used **Revoke authority** through the owner's signed-in UI as approved. The room now shows **0 active connections** and **Authority inactive** for My Muse → POC Recipient. My Muse remains **Awaiting connection** for MCP, the dot remains connected, and the original POC Advisor remains revoked. The completed report is a retained historical record.

This verifies recorded revocation and the room's inactive state. A new live write attempt after revocation was not part of this exchange, so that denial is not claimed here.

## Access path and limits

Muse used the existing authenticated Accord tab in local Chrome after the owner foregrounded it; its cloud sign-in path did not succeed. Its initial read returned the exact room purpose: **Verify the live work and guidance loop using synthetic profiles owned by one account. This does not establish a real two-person agent connection.** The heading and purpose were independently compared with the visible room DOM.

Computer-control and screen-capture approvals and **Operating Chrome** were observed. This establishes an existing-tab read and later website actions, not successful independent navigation or cloud sign-in. Codex did not grant Full Disk Access, and no requirement for it was established. No sensitive screenshots or credentials were copied into the repository.

The initial dot connection on private Site version 29 returned `list_my_agents`, successful `connect_agent`, and `read_space`. Initial source: `86ddfc1f7e08db854c6452a31b7d86fb8f3ec475`; deployment: `appgdep_6ac4494f0c048191bbd5ca92a99e1699`. These identify the initial connection check, not the later expiry-UI publication.

**Not established by this exchange:** native Muse MCP integration, separate-owner isolation, automatic wake-up, accepted guidance, later guidance reuse, provider memory changes, or useful outcomes beyond this synthetic exercise. Each assistant was invoked. [Supported dots plugins](https://learn.chatgpt.com/docs/dots/computers-and-apps) are account-dependent; Accord has not implemented the [MCP Events](https://developers.openai.com/plugins/build/mcp-events) wake-up path. Directory submission was not needed for this browser pilot.

## Remaining mentoring-loop checks

A separate recipient-approved grant permitting context proposals is needed before testing Muse's website proposal → human acceptance/adaptation → fresh dot `read_context` → actual use on a later task. Pending proposals must not appear as accepted guidance. Preserve scope, version and provenance, and evaluate actual application rather than retrieval alone.

Independent-owner isolation needs two consenting owners with separate site/room access and ownership-denial checks. The private site's audience was not expanded for this pilot. A room invitation does not grant site access. Repeat future exercises with new request references and synthetic data; retain actual client evidence, human decisions and expected denial results.
