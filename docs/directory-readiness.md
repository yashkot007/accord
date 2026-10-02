# Accord directory readiness

Status changed 2026-10-01: delivery-format selection and directory work are deferred until the owner tests and approves the functional POC. The requirements below are retained for later evaluation, not a commitment to a marketplace or the current implementation priority.

Reviewed 30 September 2026. Accord is a private prototype. It has not been submitted to or accepted by the ChatGPT or Claude directories. This is a preparation plan, not a compliance certification.

## Product and presentation

The product is a shared place where personal agents participate in relationships with explicit permissions. Use a plain **accord** wordmark and a modern sea-glass, charcoal, and off-white interface, with clear descriptions of privacy and real controls. The host, rooms, and visits remain service concepts and protocol names; they do not require a literal inn setting. Avoid invented activity, approval badges, encryption claims, or promises of universal compatibility.

Keep the working remote MCP entrance separate from claims about a directory listing. The current Site authenticates a person; profiles within the same account are not independent security principals. The [backend design](backend-design.md) proposes agent-bound connections as future work.

The [Space competitive assessment](space-competitive-assessment.md) distinguishes existing OpenAI capabilities from Accord's unproven cross-provider relationship hypothesis. Preserve the broad relationship uses without claiming that a shared workspace alone is differentiated.

## OpenAI submission preparation

The current OpenAI workflow uses a reviewed plugin package for the ChatGPT and Codex directory. Prepare developer and domain verification, a production endpoint reviewers can reach, accurate metadata and tool annotations, and HTTPS product, support, privacy, and terms pages. Review materials include a dedicated test account, five positive cases, three negative cases, a video walkthrough, and release notes. Approval and publication are separate steps. See the [submission guide](https://developers.openai.com/plugins/deploy/submission) and [server review requirements](https://developers.openai.com/plugins/deploy/app-review).

## Claude submission preparation

For the remote connector route, verify a reachable HTTPS endpoint and OAuth that works with Claude. Test every tool, supply clear setup documentation, a populated reviewer account, listing metadata, a privacy policy, and a support contact. Audit human-readable tool titles and operation annotations. An external website is not automatically an embedded MCP App. See the [connector submission guide](https://claude.com/docs/connectors/building/submission).

Claude's directory policy prohibits instructional software from directing Claude to dynamically fetch external behavioral instructions for execution. Accord's context-sharing concept therefore needs explicit policy review. A possible product boundary is user-requested relationship records and task guidance that the user can inspect and choose to apply. This is a design proposal, not assurance that the product qualifies. Do not substitute remote system instructions, seek private assistant history or memory, or treat third-party source material as permission. See the [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).

## Work remaining

- Resolve the context-sharing policy fit before preparing directory claims.
- Test real authorization and tool calls separately in ChatGPT and Claude. Local tests do not demonstrate external OAuth interoperability.
- Audit tool titles, schemas, destructive behavior, idempotency, and protocol negotiation against actual clients.
- Implement and document appropriate retention, deletion, support, and incident handling before writing public policy promises.
- Prepare reviewer access and repeatable positive and negative scenarios without exposing real user records.
- Test each additional personal agent independently. Muse, Instinct, and OpenClaw are requested targets, not verified integrations.

The broad ambition remains agent interoperability. Compatibility is earned through a tested connection, authentication, tool invocation, permission enforcement, and revocation flow for each client.
