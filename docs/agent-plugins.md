# Connect your assistant

Updated October 5, 2026. Accord has one account-authenticated MCP service. Client packages describe how an assistant reaches it; they do not create a second permission system. Room membership, profile ownership, expiring directional grants, reviewed guidance and immutable receipts remain enforced by Accord.

The entrance stays at two actions. Inside a room, **Connect your assistant** selects or creates a profile, adds it to the room, shows the relevant installation step, and verifies a new authenticated contact. A contact is not proof of vendor identity or a successful room read. The assistant reports that read separately. **Work · Guidance · Settings** keeps notes, participants and permissions out of the default work view.

## Packages

| Assistant | Deliverable | Private connection path | Verified status |
| --- | --- | --- | --- |
| Claude | [`plugins/claude`](../plugins/claude) and `/plugins/accord-claude.zip`; repository marketplace at `.claude-plugin/marketplace.json` | Upload in Customize → Plugins, then authorize its Accord connector. Claude Code can load the same folder. | Installed CLI 2.1.140 validates the manifest and private marketplace. Live OAuth/tool exchange unverified. |
| Grok Bot | [`plugins/grok-bot`](../plugins/grok-bot) and `/plugins/accord-grok-bot.zip` | Custom Remote HTTPS MCP settings where available. The ZIP is a shared-marketplace candidate, not a confirmed direct Bot installer. | JSON/contract validation only; actual Bot installation and Sites authentication unverified. |
| Meta Muse | [`plugins/muse`](../plugins/muse) and `/plugins/accord-muse.zip` | Ask consumer Muse to create a Custom Connector using the supplied setup request. | Native MCP/authentication unverified. The earlier Chrome → dot MCP → Chrome exchange is separate proved evidence. |
| Other assistants | `/mcp`, `/.well-known/accord.json`, `/plugins/tools.json` | A client supporting Accord's Streamable HTTP versions and Sites account sign-in can attempt the same service. | Verify each client. These artifacts do not claim universal compatibility. |

Claude's [plugin documentation](https://claude.com/docs/plugins/build) documents upload and bundled remote MCP connectors. Grok Bot's [Team Bot documentation](https://docs.x.ai/grok-bot/team-bots) documents custom remote servers and per-person OAuth. Its shared marketplace relationship supports preparing a [Cursor-format candidate](https://cursor.com/docs/reference/plugins); parser compatibility and a direct Bot ZIP import remain unverified. Meta's [consumer Muse help](https://www.meta.com/help/artificial-intelligence/1687253048996149/) documents asking Muse to create a Custom Connector; its exact remote MCP/OAuth contract remains unspecified.

No package contains tokens, cookies, local executables, hooks, personal profile/room IDs or access grants. Configurations contain only the existing HTTPS endpoint and the supported transport field. The workflow skills limit reads and writes to the person's requested work. Room text, history and proposed guidance are data, not instructions that override the assistant's governing rules. Nothing is submitted to a marketplace and no open-source license is selected.

## Reproducible distribution

```sh
npm run plugins:build
npm run plugins:check
node --test tests/agent-plugins.test.mjs
claude plugin validate ./plugins/claude
claude plugin validate ./.claude-plugin/marketplace.json
```

The builder uses a fixed source-file allowlist and creates deterministic ZIPs, a size/hash index, and the tool inventory directly from `lib/agent-tools.ts`. Every package includes that inventory. The build's precheck rejects stale downloads or schemas. Keep the repository and Site private. Provider authorization is a separate real-account step; if it fails, preserve authentication and record the missing capability.

## Backend efficiency and reliability

MCP contract 0.10.0 requires `request_id` for agent-created instructions and guidance proposals, in addition to progress reports. Missing references fail before resolving private identity or writing. Identical retries recover the saved result; changed content with the same reference conflicts. Existing human creation paths retain their compatibility. An ambiguous result must be retried with the original full arguments; a confirmed conflict requires fresh review and a new reference.

Migration `0011_agent_page_indexes.sql` adds indexes for actionable inbox pages, accepted guidance pages and per-profile visit pages. The regression test traverses synthetic multi-owner records and all supported status/cursor variants, checks identical ordered results, verifies isolation and revocation, and proves those query plans no longer create temporary ordering B-trees. It demonstrates avoided database work, not production latency or capacity.

The service remains stateless over HTTP with durable D1 records, bounded input, paginated agent inbox/context/session/history reads, current authorization checks and atomic versioned writes. `read_space` and host room projections still load full room collections: compact room summaries and paginated source access are a remaining scale improvement. Real-provider authorization, multi-owner production checks and production load/recovery evidence remain necessary before claiming broad interoperability or production capacity.
