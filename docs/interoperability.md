# Accord interoperability evidence

Reviewed 2026-09-30. This record separates application behavior from real provider compatibility. A deployed MCP endpoint, a provider label, or a successful local test does not establish a working integration or marketplace acceptance.

## Verified scope

| Environment | Evidence | What it establishes |
| --- | --- | --- |
| Local SQLite with generated migrations | 25 tests in `tests/*.test.mjs`, including four actual HTTP-handler tests | Tested workspace rules, request bounds, private exact-profile recovery, pagination, current permission checks, duplicate-safe work/proposals, and versioned human decisions. |
| Local MCP handler | Initialize with 2025-11-25, 2025-06-18, and 2025-03-26; tool discovery; notification handling; malformed envelope/schema rejection; two synthetic owners complete an exchange | The implemented stateless JSON request path and business rules work in this test environment. The injected test resolver does not test OAuth or the hosting proxy. |
| Local running application | HTTP initialization reports 0.4.0; all 14 tools discovered; signed-in session, inbox, and context page reads pass; missing/forged identity denied by local middleware; foreign origin denied by the development server | The framework route and local development sign-in work together. These checks do not test the production hosting authentication boundary. |
| Private Sites publication | Release `fc34c68e0632194394f06b4ff50ad7bbb6c26938`, deployment `appgdep_6abdbe47d7d88191b4c1c9390c6ab345`, succeeded with MCP enabled | Hosting accepted that specific release. Later source revisions require their own successful deployment record. |
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
