# Accord → Meta Muse

Updated 2026-10-01. Muse is the owner's first provider priority. Status: setup prepared; consumer connection unverified. No submission, approval, Muse OAuth grant or Muse tool call has occurred.

## Verified provider entry

Meta's [Connect recap](https://developers.meta.com/blog/meta-connect-recap/) links the consumer [Muse Connector Platform](https://muse.ai/platform). Its public route describes submission, functional/security/legal review and provider end-to-end testing before directory availability. On 2026-10-01, Chrome opened “Submit a connector” and showed “Submit your connector for review” with a work-email sign-in and mobile/email field. The submission form and technical contract remain behind sign-in.

The owner must sign into the existing intended account so we can inspect that contract. Do not substitute [Muse Code](https://dev.meta.ai/docs/muse-code/extending), Meta Model API inference or the separate Meta AI Connectors preview for a connection to a person's consumer Muse agent.

## Implemented setup

Muse appears first in Accord's provider cards. “Set up Muse” opens a dialog containing the official portal, an explicit choice among the signed-in person's non-revoked Muse profiles, an existing profile-creation path, public connection details and a profile-specific verification prompt. Nothing is submitted to Meta by this dialog, and it does not collect Meta credentials.

The Connect control on a Muse profile opens this same provider-specific flow with the clicked profile selected, rather than giving ChatGPT/Codex plugin instructions. Chrome verified profile creation through this flow: the owner's “My Muse” profile is saved as awaiting connection, with no activity, space attachment or authority grant. The profile-creation handoff returned focus to the workspace heading. This is setup evidence, not a Muse account connection.

The prompt is available only after choosing a profile. It instructs the agent to confirm ownership and active state, connect that exact profile, retrieve all guidance/inbox pages, retain scope/version/attribution, and stop on missing tools or failure. Copying or creating a profile never establishes a connection. The Muse card remains “Connection unverified.” Generic profile activity can come from any client authenticated as its owner; it is not provider attestation.

## Connection preparation

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
| Actual client evidence | Installed Accord plugin in Codex, one owner with two synthetic profiles; no Muse result |

Proposed product description for the provider: Accord lets a person's agent read chosen relationship context, receive scoped instructions, report progress and propose guidance. The recipient reviews guidance before adoption. People retain control over space membership, shared sources and directional authority. Existing accepted guidance is retrieved with its version and provenance for relevant later tasks. Accord does not run Muse, alter its private memory or claim improved outcomes from retrieval alone.

## Requirements to inspect after sign-in

1. Determine whether the consumer platform allows private developer testing, a custom MCP endpoint, an API connector or only reviewed directory entries. Record the actual fields and required protocol version; do not invent a Muse authorization endpoint.
2. Verify supported OAuth discovery, client registration, callback rules, scopes and account linking against Sites-managed authentication. Preserve the hosting identity boundary. Do not add an independent token flow or accept caller-supplied identities merely to make a client work.
3. Check required product, support, privacy, terms and reviewer-access materials. The current private Site is not automatically reviewable. Prepare any missing materials honestly before a submission; changing audience or sending a submission is a separate action.
4. Determine whether a newly enabled connector is automatically visible to a user's personal agent and whether its invocation model supports Accord's tools. Provider consent is not consent to share all private relationship or meeting notes.

## Real Muse verification

Use the consenting owner's account and an explicitly selected test profile. First read only its owned profiles, verify the intended ID, and confirm the profile. Then read authorized spaces, every guidance/inbox page and current versions. Exercise a bounded synthetic instruction, progress report, proposal, human review and later fresh Muse retrieval. Record the actual Muse client/version, deployment, authorization flow and resulting tool calls. Also verify denied reverse authority, revoked grants and a disconnected profile; preserve immutable retry receipts.

Generic profile status or an owner-authenticated Codex call cannot prove this journey happened from Muse. The exact Muse tools/schema, OAuth expiry/reconnect, provider permissions and two-person boundaries need their own evidence. The current 137-test local suite and production Codex evidence do not establish Muse compatibility.

No live provider test or directory acceptance is recorded until those steps actually happen. See [interoperability](interoperability.md) and [directory readiness](directory-readiness.md) for the existing evidence boundaries.
