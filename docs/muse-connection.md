# Accord → Meta Muse

Updated 2026-10-05. Muse is the owner's chosen peer for a pilot with an existing OpenAI dot. Status: consumer account signed in; the browser task reached Accord's sign-in wall and is waiting for human takeover. Authenticated room access and the peer exchange remain unverified. No submission, approval, Accord connector authorization or Muse MCP tool call has occurred.

## Current browser pilot

The owner chose a Muse task to operate Accord's website and exchange work with the dot through the existing room controls. This is a browser route, not an MCP connector. Directory submission is not a prerequisite. The next check is actual Muse browser access to the private room, supported sign-in where required, a bounded website assignment, the dot's real MCP inbox/report calls, and Muse reading the response. No arbitrary private MCP attachment is assumed.

At 6:17 p.m. Pacific on 2026-10-05, **Chats → New side chat** created [Accord browser access test](https://muse.ai/thread/f919e4af-39ae-47b4-a4bd-7c4ff63f8af0), with the task **Open Accord test session**. It was limited to reading the exact POC room and profile names, stopping for sign-in and making no writes or permission changes.

The actual browser returned **Waiting for you · Sign-in required to view room** and showed Accord's private sign-in page with **Continue with ChatGPT**. Its preview was opened in Chrome for takeover. The owner explicitly authorized private Accord account access in the Muse-controlled browser; human sign-in is still pending. The signed-in account can access its other spaces even though this task is room-limited. No room data was read and no writes or peer exchange occurred. Creating this side chat and task did not create a second independently credentialed personal agent.

Website writes are recorded by Accord as person-submitted actions. Retain the actual Muse task and browser trace alongside room/task IDs; generic profile activity or a provider label cannot identify Muse. Do not copy authentication tokens or substitute Codex calls. The [pilot plan](dots-pilot.md) records the remaining instruction, guidance-review, later-reuse and revocation checks.

## Verified provider entry

Meta's [Connect recap](https://developers.meta.com/blog/meta-connect-recap/) links the consumer [Muse Connector Platform](https://muse.ai/platform). Its public route describes submission, functional/security/legal review and provider end-to-end testing before directory availability. On 2026-10-01, Chrome opened “Submit a connector” and showed “Submit your connector for review” with a work-email sign-in and mobile/email field. The submission form and technical contract remain behind sign-in.

The owner must sign into the existing intended account so we can inspect that contract. Do not substitute [Muse Code](https://dev.meta.ai/docs/muse-code/extending), Meta Model API inference or the separate Meta AI Connectors preview for a connection to a person's consumer Muse agent.

## Implemented setup

Muse appears first in Accord's provider cards. “Set up Muse” opens a dialog containing the official portal, an explicit choice among the signed-in person's non-revoked Muse profiles, an existing profile-creation path, public connection details and a profile-specific verification prompt. Nothing is submitted to Meta by this dialog, and it does not collect Meta credentials.

The Connect control on a Muse profile opens this same provider-specific flow with the clicked profile selected, rather than giving ChatGPT/Codex plugin instructions. Chrome verified profile creation through this flow: the owner's “My Muse” profile is saved as awaiting connection, with no activity, space attachment or authority grant. The profile-creation handoff returned focus to the workspace heading. This is setup evidence, not a Muse account connection.

The prompt is available only after choosing a profile. It instructs the agent to confirm ownership and active state, connect that exact profile, retrieve all guidance/inbox pages, retain scope/version/attribution, and stop on missing tools or failure. Copying or creating a profile never establishes a connection. The Muse card remains “Connection unverified.” Generic profile activity can come from any client authenticated as its owner; it is not provider attestation.

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
| Actual client evidence | Codex synthetic-profile tests and one real OpenAI dot connection/read on private Site version 29; real Muse browser task reached Accord's sign-in wall, awaiting human takeover; no authenticated Muse room read or exchange |

Proposed product description for the provider: Accord lets a person's agent read chosen relationship context, receive scoped instructions, report progress and propose guidance. The recipient reviews guidance before adoption. People retain control over space membership, shared sources and directional authority. Existing accepted guidance is retrieved with its version and provenance for relevant later tasks. Accord does not run Muse, alter its private memory or claim improved outcomes from retrieval alone.

## Remaining connector contract checks

1. Determine whether the consumer platform allows private developer testing, a custom MCP endpoint, an API connector or only reviewed directory entries. Record the actual fields and required protocol version; do not invent a Muse authorization endpoint.
2. Verify supported OAuth discovery, client registration, callback rules, scopes and account linking against Sites-managed authentication. Preserve the hosting identity boundary. Do not add an independent token flow or accept caller-supplied identities merely to make a client work.
3. Check required product, support, privacy, terms and reviewer-access materials. The current private Site is not automatically reviewable. Prepare any missing materials honestly before a submission; changing audience or sending a submission is a separate action.
4. Determine whether a newly enabled connector is automatically visible to a user's personal agent and whether its invocation model supports Accord's tools. Provider consent is not consent to share all private relationship or meeting notes.

## Future MCP connector verification

Use the consenting owner's account and an explicitly selected test profile. First read only its owned profiles, verify the intended ID, and confirm the profile. Then read authorized spaces, every guidance/inbox page and current versions. Exercise a bounded synthetic instruction, progress report, proposal, human review and later fresh Muse retrieval. Record the actual Muse client/version, deployment, authorization flow and resulting tool calls. Also verify denied reverse authority, revoked grants and a disconnected profile; preserve immutable retry receipts.

Generic profile status or an owner-authenticated Codex call cannot prove this journey happened from Muse. The exact Muse tools/schema, OAuth expiry/reconnect, provider permissions and two-person boundaries need their own evidence. The current 137-test local suite and production Codex evidence do not establish Muse compatibility.

The browser access attempt is recorded above. No authenticated Muse room read, MCP provider connection, peer exchange or directory acceptance is recorded. See [interoperability](interoperability.md) and [directory readiness](directory-readiness.md) for the existing evidence boundaries.
