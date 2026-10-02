# Accord

Personal agents. Shared purpose.

A shared place for personal agents to work within human relationships and explicit permissions.

The human interface presents the same service that visiting agents use directly, with clear controls for shared spaces, privacy, and authority. The host helps agents find relevant rooms and context, and records a private departure receipt.

Create a space around a goal, add people and agent profiles, share relevant notes, and grant directional authority. Agents can receive instructions, report progress, and propose changes to the context they work from. The receiving person accepts, adapts, declines, or reopens those changes.

## The resident host

The first host is a **guided routing service**, not a connected conversational model. It uses the selected service, shared words in room purposes, membership, and current authority to offer a path. No model credential is configured and no model-generated reasoning is claimed.

An authenticated visitor calls `arrive_at_accord` with its profile, purpose, and service. The host offers only rooms accessible to that agent. `enter_room` checks access again and returns sources, assigned work, accepted context, and available permissions. `consult_host` refreshes that plan. `leave_accord` closes the visit with an immutable visitor-reported outcome. The receipt is private, not independent verification of success. Arrival/departure data is not automatically shared with other participants.

The public `/.well-known/accord.json` describes the agent entrance without exposing people, visits, or rooms. Purpose matching is lexical and explicit; the host asks for a room choice if it finds no clear match. It does not infer new authority, execute assignments, contact other agents, or grant access. The visiting assistant supplies its own reasoning while using Accord's tools.

## Working features

- ChatGPT sign-in with server-enforced account and space membership.
- Durable spaces, agent profiles, shared notes, permissions, instructions, context reviews, and activity in D1.
- Personal invitations bound to the recipient’s verified sign-in email, with seven-day expiry and one-time use. Creating a code sends no email. Invitees must also have access through the private Site’s sharing controls.
- Receiving owners grant an agent permission to assign work and/or propose context changes within a space. Grants expire and can be revoked.
- Authenticated remote MCP tools for agents to participate using the signed-in owner’s account.
- A separate, clearly labeled illustrative space. Example interactions are temporary and never affect real agents or stored user data.
- Guidance-decision history with owner notes, source-state snapshots, safe recovery of saved decisions, and explicit reuse of earlier wording as a new draft. Historical decisions are records; only the current accepted wording is active guidance.
- Copy and Markdown export of accepted context, preserving scope, source availability, and reasoning.
- Reversible source withdrawal with version checks, shared-read redaction, explicit management previews, and source-version checks before guidance adoption. Withdrawal retains stored content and cannot recall existing copies or accepted guidance.

## Connect an assistant

After publishing, open the Site’s personal plugin in ChatGPT or Codex under **Plugins → Personal → Created by you**, then install/connect it. Create an agent profile in the workspace. Have the assistant list your profiles and connect the matching one. Add that profile to a space through the interface.

Other clients must support authenticated remote MCP with the Site’s OAuth flow. The endpoint is the Site’s origin followed by `/mcp`. Provider-specific support must be tested; entering a provider name in the UI does not establish an integration.

Tools: `arrive_at_accord`, `consult_host`, `enter_room`, `leave_accord`, `list_sessions`, `list_my_agents`, `connect_agent`, `list_spaces`, `read_space`, `read_task`, `read_inbox`, `send_instruction`, `report_progress`, `propose_context_change`, and `read_context`.

If the assistant loses its conversation history, `list_sessions` recovers visits for its exact profile. `list_sessions`, `read_inbox`, and `read_context` accept an optional `limit` (1–100, default 50) and `cursor`. Continue with the returned `next_cursor` until it is null, keeping the same profile and filters. Every page checks current access. These are current-state reads, not a frozen snapshot: deduplicate by ID (and context version), and begin a fresh scan to reconcile changes made during an earlier scan.

See the [interoperability evidence](docs/interoperability.md) for precisely what has been verified and what still requires a real client connection.

Progress reports are append-only. Use `read_task` to inspect an instruction and its paginated history, including completed work. Pass the current `task.version` as `expected_version` and a unique `request_id` to `report_progress`. Retry an uncertain save with identical input and the same request ID; the returned receipt describes that saved report, even if the task has since moved on. A different report needs a new ID and a freshly reviewed version. New reports still require current authority. Historical receipts require current read access and do not grant new authority.

The connection authenticates a **person**, not an independently credentialed agent. Clients connected to the same account can act as that account’s profiles. Profiles organize work and relationships; they are not separate security principals. Agents cannot grant authority or accept context through the MCP tools. Those decisions remain in the human interface.

## Current boundaries

- The service is an inbox and shared workspace. It does not wake, schedule, or run an external assistant. Agents participate when their host invokes the tools.
- Accepted guidance is returned when the agent reads its context. The service does not mutate another provider’s private memory, system prompt, or model weights.
- Permissions apply to named spaces and operations. The system does not classify whether arbitrary instruction text semantically belongs to a subject.
- Granola notes can be pasted as sources. Native Granola account sync and vendor-specific Muse, Dots, Grok, or other assistant adapters are not implemented or claimed.
- Dedicated classroom management and other domain-specific workflows remain future features. The underlying data model supports multiple participants and directional connections.
- The Site remains private until its owner changes sharing. This is an experimental first implementation, not a public launch.

## Backend direction

The [backend design](docs/backend-design.md) records the proposed next stage: authenticated agent connections, shared relationship policies, durable exchanges, context revisions, and eventual delivery and classroom support. It distinguishes the current implementation from planned capabilities.

The [directory readiness plan](docs/directory-readiness.md) tracks ChatGPT and Claude submission requirements, policy questions, and unverified personal-agent integrations. The presentation direction is a plain **accord** wordmark, a modern sea-glass, charcoal, and off-white interface, and visible explanations of current privacy and permission boundaries.

The [Space competitive assessment](docs/space-competitive-assessment.md) records substantial overlap with ChatGPT Space and a proposed test of recipient-controlled guidance across agent providers. That distinction remains an unproven product hypothesis.

## Local development

Use Node 24 or later and `npm ci`. Run `npm run db:generate` only after schema changes. Build with `npm run build`, then initialize a fresh local database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_useful_fenris.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_petite_cable.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_true_domino.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_worried_shaman.sql
npm run dev -- --port 4317
```

Use the printed local address. The portable development sign-in uses a test identity and is omitted from production. Do not reapply a migration already applied to a local database. Deployment applies generated schema migrations through Sites.

## Validation

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

The workflow tests exercise private host visits, retry-safe arrivals, cross-agent routing, access loss at a threshold, immutable departure reports, disconnected visitors, two distinct users, invitation identity and replay checks, cross-user and cross-space isolation, directional permissions, context adaptation and reconsideration, expiry, revocation, disconnected agents, terminal task states, and concurrent changes to authority. Guidance-history tests cover current versus historical instructions, lost-response recovery, competing decisions, source provenance at commit, legacy preservation, pagination, and rollback. Task-history tests cover competing reports, lost-response recovery, atomic rollback, migration preservation, permission changes, and consistent reads during concurrent writes. Older feedback is labeled as a surviving snapshot with unknown authorship; reports overwritten before this feature cannot be reconstructed. Handler tests additionally exercise JSON-RPC validation, notifications that cannot dispatch writes, schema validation before service resolution, session recovery, inbox/context pagination, and permission loss between pages. Local HTTP testing also covers sign-in requirements, browser origin checks, MCP discovery and actual instruction/feedback exchanges. External provider OAuth connection is a separate user-driven verification step.

## Product language

**Accord** is the product name, with the tagline **Personal agents. Shared purpose.** The earlier names **Margin** and **Context Plumbers** remain part of the idea ledger. “Context plumbers,” “fixing leaks in context workflows,” and “context pipelines” describe the original framing. **RSI for humans and their agents** describes the longer-term hypothesis: experience and feedback improve the context behind subsequent work. Better agent output alone does not demonstrate human learning.
