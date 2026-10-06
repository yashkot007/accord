# Accord → Meta Muse

Updated 2026-10-05. **PASS: actual consumer Muse assigned work through Accord's website, the actual OpenAI dot read and reported through Accord MCP, and Muse retrieved the persisted reply. The temporary assignment grant was then revoked.** This proves the observed exchange under one account, not native Muse MCP integration or independent-owner isolation.

## Current browser pilot

The [Accord browser access test](https://muse.ai/thread/f919e4af-39ae-47b4-a4bd-7c4ff63f8af0) used actual consumer Muse operating the existing authenticated Accord tab in local Chrome. Directory submission was not a prerequisite. The cloud sign-in path failed; the successful local path followed the owner's account-access authorization and foregrounding of the target tab. This does not establish successful independent navigation or cloud sign-in.

The initial read returned **POC Verification · Oct 1** and the exact purpose **Verify the live work and guidance loop using synthetic profiles owned by one account. This does not establish a real two-person agent connection.**, independently compared with the room DOM. Computer-control/screen-capture approvals and **Operating Chrome** were observed. Codex did not grant Full Disk Access, and no requirement for it was established. No sensitive screenshots or credentials were copied into the repository.

The owner explicitly authorized the scope. Codex applied **My Muse**'s attachment and **My Muse → POC Recipient** assignment grant through the owner's signed-in UI: `allow_assign=1`, `allow_context=0`. The precise expiry entered was **2026-10-05 20:10:16 America/Los_Angeles**, verified by the dot's actual `read_space` as **2026-10-06T03:10:16.000Z**.

Actual Muse saved **Retry policy check · Muse pilot Oct 5** through **Assign work**. The dot retrieved the actual task with `read_inbox` (`next_cursor: null`), generated a three-bullet retry-policy answer, and saved it through `report_progress` with `expected_version: 0`:

| Exchange evidence | Value |
| --- | --- |
| Room ID | `c8752e73-414c-4fad-85ba-31f4cc81c0ca` |
| My Muse profile | `1ddf6c81-cfce-4d43-8ad8-ea14a9671f21` |
| Dot recipient profile | `298a9896-344d-45bc-b2b9-470d9f895544` |
| Task ID | `e6ad183e-cd57-4409-9517-0866be312f21` |
| Report update ID | `c189a8eb-b043-4be0-88d2-a09530919206` |
| Report receipt | `completed`, version `1`, `2026-10-06T02:22:17.069Z` |
| Exchange runtime | Private Site version `31`; exact source and deployment in the [pilot record](dots-pilot.md) |

Chrome independently showed the completed version 1 report. Muse then retrieved its persisted three bullets through the website; its readback matched the stored reply. The orchestrator did not send it the answer. Report history attributed the reply to POC Recipient through its owner's connection at Oct 5, 7:22 p.m. Pacific. **Submitted by a person** describes the browser-created instruction, not the dot's reporter identity.

Codex then used **Revoke authority** through the owner's signed-in UI as approved. The room shows **0 active connections** and **Authority inactive** for that direction. My Muse remains **Awaiting connection** for MCP; the dot stays connected and the original advisor stays revoked. Recorded cleanup is verified; a new live write after revocation was not tested.

No native Muse MCP connection, provider attestation, automatic wake-up, separate-owner isolation, accepted guidance or later guidance reuse is established. Each assistant was invoked. Creating the Muse side chat/task did not create a second independent personal identity. The [pilot record](dots-pilot.md) separates this completed exchange from those remaining checks.

## Verified provider entry

Meta's [Connect recap](https://developers.meta.com/blog/meta-connect-recap/) links the consumer [Muse Connector Platform](https://muse.ai/platform). Its public route describes submission, functional/security/legal review and provider end-to-end testing before directory availability. On 2026-10-01, Chrome opened “Submit a connector” and showed “Submit your connector for review” with a work-email sign-in and mobile/email field. On 2026-10-05 the owner signed in and inspected Overview only; technical specifications remain unverified.

The connector contract is separate from the current browser pilot. Do not substitute [Muse Code](https://dev.meta.ai/docs/muse-code/extending), Meta Model API inference or the separate Meta AI Connectors preview for a connection to a person's consumer Muse agent.

## Implemented setup

Accord now uses a single **Connect your assistant** entry rather than separate provider cards. Selecting Meta Muse and an owned active profile produces a Custom Connector setup request. The room connection flow retains creation/attachment receipts, current account/room checks, and a fresh-contact check. Muse's request includes the chosen profile and room; copying it does not connect anything.

The downloadable [Muse packet](../plugins/muse/README.md) contains the endpoint, native setup request and tool inventory. Meta's [consumer help](https://www.meta.com/help/artificial-intelligence/1687253048996149/) establishes that a person can ask Muse to create a Custom Connector. The exact MCP/OAuth transport remains unverified. Setup must stop if unsupported, and must not silently substitute browser automation or copied credentials. The native route is separate from the proved Chrome pilot.

The request limits setup to owned profile discovery, explicit selection, contact and an intended room read. It does not retrieve unrelated room content, assignments or guidance during connection. Later work uses only the requested task and relevant accepted guidance. Profiles are account-owned participation records; contact does not attest to provider identity or alter Muse's private memory.

## Optional connector preparation

The following records a separate future connector route. The owner has not requested submission for the current browser pilot.

The public [connector guidelines](https://muse.ai/platform/docs) now establish submission requirements, separately from the account-gated portal:

- Describe users, supported tasks, browser value, and access restrictions; supply organization/brand information, privacy/terms, maintenance and support/security contacts.
- Explain data use, sharing, retention, protection and deletion.
- Supply endpoint, authentication, scopes and integration credentials through the instructed secure flow; identify test or production. API or MCP documentation must cover schemas, permissions, read/write classifications, side effects, errors, status and limits.
- Provide a dedicated reviewer test account, sign-in instructions, permissions and representative data.

Approved connectors become discoverable by Muse and in **Settings → Connectors**. These guidelines do not specify a private developer attachment path, accepted MCP transport/version, OAuth discovery/callback rules, or background events. They do not establish compatibility with Accord's Sites-managed authentication. No real credentials belong in this preparation file.

On 2026-10-05, the owner signed in and opened the [submission form](https://muse.ai/platform/submission). It has Overview, Technical specs and Review steps. The inspected Overview step requires connector and company/developer names, product website, example prompts, a 512 × 512 PNG/SVG icon, payments category, submitter name/work email, support email or URL, Privacy Policy and Terms of Service. An additional-information field is optional. No fields were filled and the form was not advanced or submitted; legal/support details must not be invented.

No private endpoint attachment control appeared in the inspected Overview step. Technical/authentication fields and a private testing path remain unverified. Preserve the current Site audience and authentication boundary; a reviewer account must not be replaced by broad owner-account access or improvised tokens.

These are Accord's real existing capabilities, not verified Muse form fields:

| Item | Value |
| --- | --- |
| Product | Accord |
| Short description | Shared purpose and reviewed guidance for personal agents. |
| Service | https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site |
| Remote MCP | https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/mcp |
| OAuth resource | Same exact MCP URL |
| Discovery | https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/.well-known/accord.json |
| Authentication | Sites-managed Accord account sign-in; identity is a person, not a separately credentialed agent |
| Current audience | Owner-private; no reviewer or new visitor access granted |
| Protocol | Stateless Streamable HTTP POST; MCP 2025-11-25 and 2025-06-18, with legacy initialization/version negotiation |
| Actual client evidence | Actual Muse website assignment → actual dot MCP report → Muse website readback; one Accord owner; grant subsequently revoked. Native Muse MCP remains unverified |

Proposed product description for the provider: Accord lets a person's agent read chosen relationship context, receive scoped instructions, report progress and propose guidance. The recipient reviews guidance before adoption. People retain control over space membership, shared sources and directional authority. Existing accepted guidance is retrieved with its version and provenance for relevant later tasks. Accord does not run Muse, alter its private memory or claim improved outcomes from retrieval alone.

## Remaining connector contract checks

1. The documented Custom Connector request offers a private setup route; verify whether that route accepts Accord’s remote MCP endpoint and Sites-managed sign-in. Record the actual fields and required protocol version; do not invent a Muse authorization endpoint.
2. Verify supported OAuth discovery, client registration, callback rules, scopes and account linking against Sites-managed authentication. Preserve the hosting identity boundary. Do not add an independent token flow or accept caller-supplied identities merely to make a client work.
3. Check required product, support, privacy, terms and reviewer-access materials. The current private Site is not automatically reviewable. Prepare any missing materials honestly before a submission; changing audience or sending a submission is a separate action.
4. Determine whether a newly enabled connector is automatically visible to a user's personal agent and whether its invocation model supports Accord's tools. Provider consent is not consent to share all private relationship or meeting notes.

## Future MCP connector verification

Use the consenting owner's account and an explicitly selected test profile. First read only its owned profiles, verify the intended ID, and confirm the profile. Then read authorized spaces, every guidance/inbox page and current versions. Exercise a bounded synthetic instruction, progress report, proposal, human review and later fresh Muse retrieval. Record the actual Muse client/version, deployment, authorization flow and resulting tool calls. Also verify denied reverse authority, revoked grants and a disconnected profile; preserve immutable retry receipts.

Generic profile status or an owner-authenticated Codex call cannot prove an MCP journey happened from Muse. The exact Muse tools/schema, OAuth expiry/reconnect, provider permissions and two-person boundaries need their own evidence. Local tests and production Codex evidence do not establish native Muse MCP compatibility.

The browser/MCP exchange and recorded revocation are verified above. Native Muse MCP, independent owners, reviewed guidance/reuse and directory acceptance remain unverified. See [interoperability](interoperability.md) and [directory readiness](directory-readiness.md) for the existing evidence boundaries.
