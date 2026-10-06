# Connect your assistant

Updated October 5, 2026. Accord has one account-authenticated MCP service. Client packages describe how an assistant reaches it; they do not create a second permission system. Room membership, profile ownership, expiring directional grants, reviewed guidance and immutable receipts remain enforced by Accord.

The entrance stays at two actions. **Connect your assistant** now uses one flow from Your assistants, a saved assistant card, or a room. Select a saved assistant or choose a provider; a new assistant gets a default name, with renaming optional. The exact owned profile determines the installation instructions. Account setup saves/selects that profile without joining or attaching to a room; room setup also attaches it to the selected room. Both check for a fresh authenticated contact. A contact is not proof of vendor identity or a successful room read. The assistant reports that read separately. Global setup asks which room to use before reading its contents. **Work · Guidance · Settings** keeps notes, participants and permissions out of the default work view.

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

MCP contract 0.12.0 requires `request_id` for agent-created instructions and guidance proposals, in addition to progress reports. Missing references fail before resolving private identity or writing. Identical retries recover the saved result; changed content with the same reference conflicts. Existing human creation paths retain their compatibility. An ambiguous result must be retried with the original full arguments; a confirmed conflict requires fresh review and a new reference.

Packages 0.3.0 include the optional inbox projection and direct assistants to select relevant work from previews, then retrieve full detail. `connect_agent` returns the recorded `last_seen_at` and `contact_version`; explicit connection calls always advance the counter. The human connection check compares it with the counter captured before setup, rather than relying on wall-clock ordering. Ordinary authenticated reads coalesce contact writes for thirty seconds and retain fresh ownership/resource checks. Contact remains account/profile evidence, not provider identity or proof of completed work.

`read_inbox` accepts `projection: "summary" | "full"`. Omitting it retains the full response and historical full-page cursor scope. Summary pages have their own cursor scope and return identity, title, status/version, scope, a 300-character body preview, body length and whether feedback exists. They omit full bodies and saved feedback. Before acting or reporting, call `read_task` for the chosen task and read its complete instruction, current authority and relevant report history. The final inbox query rechecks current ownership as well as actionable grants; a preview does not confer authority.

Migration `0011_agent_page_indexes.sql` adds indexes for actionable inbox pages, accepted guidance pages and per-profile visit pages. The regression test traverses synthetic multi-owner records and all supported status/cursor variants, checks identical ordered results, verifies isolation and revocation, and proves those query plans no longer create temporary ordering B-trees. It demonstrates avoided database work, not production latency or capacity.

The service remains stateless over HTTP with durable D1 records, bounded input, paginated agent inbox/context/session/history reads, current authorization checks and atomic versioned writes. `read_space` now returns compact room summaries with per-collection cursors. `read_space_section` pages through complete lists; `read_shared_source` fetches only an explicitly selected active shared source. The routing host uses bounded SQL projections instead of loading source bodies or complete history. Its permissions come from current database checks, independently of preview limits. Profile and room catalogs also paginate. Human room and account reads now return twenty summaries with continuation cursors; exact records, paged selectors and a complete revision-checked accepted-guidance export preserve access beyond the preview. Production rate policy and load evidence remain work. Real-provider authorization, multi-owner production checks and production load/recovery evidence remain necessary before claiming broad interoperability or production capacity.

Migration `0012_room_read_indexes.sql` extends the existing room indexes with timestamp and ID ordering, and adds the profile-to-room lookup index. Local regression fixtures exercise 125 records in each collection, timestamp ties, cursor isolation, source withdrawal, profile revocation, membership generation changes, and room/authority records beyond the first preview. These tests prove bounded transfer and complete traversal for that fixture; they do not establish production capacity.

Final shared-source validation joins current source state, membership and profile attachment in one read. Source ID lists use one bound JSON array through D1-supported `json_each`, so a 100-item page stays below the [D1 bound-parameter limit](https://developers.cloudflare.com/d1/platform/limits/). See [D1 JSON support](https://developers.cloudflare.com/d1/sql-api/query-json/). Local tests enforce the binding budget and inject withdrawal immediately before this final read; no full source body is returned after that withdrawal.

The final check now looks up each requested source through its primary key instead of scanning the room's source index. A synthetic local Worker/D1 workload verified full cursor traversal and identical duplicate-write receipts at 1, 8 and 24 admitted concurrent requests, with 250 and 1,000 rows per collection. See the [original source-hashed measurement record](verification/agent-load-oct5.json) and [quality notes](product-quality-plan.md#local-worker-d1-measurements-october-5-2026). Matched full/summary runs for MCP 0.12.0 reduced the large-text twenty-item inbox response from 341,114 to 36,422 bytes; both used two SQL statements, while summary joins read 192 D1 rows versus 170 for full. The [new comparison record](verification/inbox-projection-oct5.json) preserves the initial approximately fifteen-second local stall alongside the matched repeats. Its cause is unconfirmed. No production or native provider test is implied.

Local release checkpoint: 186 tests, TypeScript, deterministic package checks and Claude package/marketplace validators passed. Browser review, production build and publication for this revision are pending at this checkpoint. Distributed admission/rate protection is not implemented, and no supported Sites rate-limit binding provisioning path has been confirmed. Native Claude, Grok Bot and Muse authorization/exchanges remain unverified.

## MCP 0.13.0 / packages 0.4.0 checkpoint

Updated packages describe shorter complete-text pages and HTTP 429 retry behavior. The shared backend uses per-isolate admission and five-second bounded uploads; it does not queue or automatically replay rejected work. Honor `Retry-After`, space retries out and preserve the original arguments/request reference. Full text remains available across cursors, including exact histories and outcomes. New packaging validation checks that the advertised admission policy matches the service defaults. Native Claude, Grok Bot and Muse authentication/exchange validation remains unverified.

Human setup retains the same minimal flow. Clipboard copy states now distinguish waiting, copied and manual fallback; stale or failed operations cannot retain an earlier Copied confirmation. Current build, workload and live-browser gates are tracked in the quality plan.

This local revision passed 240 tests, TypeScript, reproducible package checks and both installed Claude validators. Four isolated Workerd/local-D1 measurements passed, including explicit overload handling and complete Unicode pages; [source hashes and measured limits](verification/agent-bounds-oct6.json) identify the tested implementation. Agent routing previews now direct clients to exact guidance readers before use. These results do not establish native provider authorization or marketplace acceptance.
