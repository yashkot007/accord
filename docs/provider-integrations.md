# Accord provider connections

Updated 2026-10-01. This describes the implementation and its evidence, not universal personal-agent compatibility. Owner POC acceptance and two-person testing remain open.

| Provider | Current implementation | Remaining verification |
| --- | --- | --- |
| Granola | Browser OAuth start and dynamic registration verified on the private Site; encrypted server-side credentials, discovered read-only MCP tools, private previews and person-selected excerpt imports implemented | Real consent/callback, actual tool schemas, note reads, expiry and disconnect with a consenting account |
| OpenAI dots | Instructions for enabling Accord's existing plugin and selecting an account-owned profile | A real dot invocation and full exchange; installed Codex plugin evidence is separate |
| Meta Muse | Clearly marked unconnected profile setup and provider requirements link | Consumer connector contract, review/access and actual authorization/calls |
| Instinct | Clearly marked unconnected profile setup | Owner's intended product URL and its supported connector contract |

## Granola connection contract

Accord uses Granola's fixed [Streamable HTTP MCP endpoint](https://docs.granola.ai/help-center/sharing/integrations/mcp). Public [resource metadata](https://mcp.granola.ai/.well-known/oauth-protected-resource/mcp) and [authorization server metadata](https://mcp-auth.granola.ai/.well-known/oauth-authorization-server) identify the issuer, endpoints, S256 PKCE and public dynamic client registration. Metadata discovery and real dynamic registration succeeded from the private Site. Consent and the OAuth callback are still unverified.

Each person authorizes their own account. OAuth state is random, hashed, owner-bound, expiring and usable once. The PKCE verifier and credentials are encrypted with AES-GCM using a server secret, distinct purposes and authenticated owner identity. Tokens are never returned to the browser. Production has a managed secret named `ACCORD_CONNECTION_ENCRYPTION_KEY`; missing or invalid configuration fails closed. Its secure recovery is required alongside any database restoration. Do not regenerate it to repair an unrelated failure.

The adapter permits only account information and three meeting-reading tools, discovers their actual schemas, and rejects unsupported filters and tool names. Fixed destinations, redirect rejection, timeouts and byte bounds constrain upstream requests. The OAuth issuer's access scope remains Granola-controlled; Accord's read-only tool allowlist is an application restriction, not a narrower provider consent scope. Account plan, workspace and administrator policy can limit available notes.

Connection generations prevent late registration or callback work from surviving disconnection. Token refresh acquires an owner/connection-bound database lease before calling the provider. Concurrent refresh attempts do not share a rotating token; failed or abandoned refresh attempts require fresh authorization. Disconnection removes Accord's stored credentials and unshared previews, cancels pending authorization and blocks later reads. It does not claim upstream token revocation or erasure of previously shared copies.

Reading creates an encrypted private preview with a 20-minute application expiry. Expired previews cannot be shared and are removed opportunistically during subsequent connection setup; there is no scheduled storage cleanup. A person chooses the destination space, title and edited excerpt before sharing. Current membership and current connection are checked at commit. Sharing creates one attributable source and clears the full preview content; identical retries recover the saved receipt, and changed retries conflict. The selected excerpt is an imported copy. It does not continuously sync, follow later Granola deletion, or automatically become accepted guidance. Existing shared-source withdrawal controls apply.

## Personal-agent setup

[dots documentation](https://learn.chatgpt.com/docs/dots/computers-and-apps) describes using supported plugins enabled for its account. Accord offers setup instructions for that path; it does not control a person's dot or write its private memory. A provider profile only organizes Accord participation and is not an independently credentialed agent.

The [Meta Muse connector platform](https://muse.ai/platform) presents a provider submission path. Public consumer protocol details and Accord approval have not been established. Muse Code documentation describes a separate product and is not evidence of personal Muse compatibility. Instinct requires an exact product URL from the owner before choosing a supported connection method.

## Local evidence and next live check

The complete local suite has 137 passing tests, including synthetic Granola authorization, owner separation, private preview/import, duplicate recovery, late disconnection, refresh concurrency/abandonment, split SSE frames, redirect rejection, unsupported input, oversized response and HTTP origin/authentication checks. TypeScript checking must accompany runtime edits. Local backup tests preserve all 19 tables; provider fixtures are opaque synthetic records, not evidence of decryptable production credentials or OAuth recovery.

The first private publication added the new controls successfully, but Granola authorization start failed on the public resource-metadata request with a runtime redirect error. No consent, tokens or notes were obtained. Sanitized diagnostics record only the fixed endpoint category, HTTP status or exception class and a bounded reason category; no upstream URL, text, headers or account content is logged. Requests use manual redirect mode and explicitly reject non-success responses without following them.

On source `480fe145849fc0685dc3bcd144d84acb710e27f5`, private deployment `appgdep_6abecf0d6e188191949c385295e54e17` succeeded with MCP enabled and environment revision 1. Chrome showed all four setup cards and opened the dots instructions. After the redirect-handling change, the Granola `connect` action returned HTTP 200 in 896 ms at 2026-10-01 21:23:08 UTC, request `6bf3141e7163940b0cc019dc0342d6b7`. That path validates public metadata, registers the OAuth client, stores an owner-bound pending flow and returns the authorization URL. Browser capture was then paused by an open Chrome extension panel. This establishes connection start, not consent, callback, authenticated provider reads or an import.

The next live check is human consent in Chrome followed by a read of an explicitly selected synthetic Granola note, preview review, a narrow import into the POC verification space, and a read through the connected Accord plugin. Record the deployment and actual client/provider schemas. Then verify disconnect and the separate lifecycle of the imported source. A successful sign-in screen alone is not a completed integration test. No real note sharing is authorized by the implementation request alone.
