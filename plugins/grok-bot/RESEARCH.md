# Evidence checked October 5, 2026

## Grok Bot, not Grok Build

- https://docs.x.ai/grok-bot/teams-and-enterprises — Grok Bot uses Cursor connector infrastructure and the team's Cursor connector policy; there is no separate Bot connector list. OAuth is held on the connector backend.
- https://docs.x.ai/grok-bot/team-bots — Custom MCP server / Remote HTTPS supports a Bot credential or each person's OAuth sign-in. Personal connections and Team Bot setup have distinct access scopes.
- https://cursor.com/help/grok-bot/connect-plugins — Bot plugin installation and provider browser authentication.
- https://cursor.com/marketplace — the marketplace explicitly advertises MCP plugins such as Runway and Migma for Cursor and Grok Bot. This supports targeting its format, but does not guarantee review acceptance or every component's runtime behavior in Bot.
- https://forum.cursor.com/t/how-do-i-share-a-custom-mcp-that-one-of-my-bots-has-built-with-the-rest-of-my-team/173538 — Cursor support's October 1, 2026 firsthand tested Team Bot path: Bot details → Plugins → Add plugins → Add custom. Personal custom server installations belong to that account. Team users sign in separately where OAuth is required.

## Candidate format

- https://cursor.com/docs/reference/plugins — Cursor manifest at `.cursor-plugin/plugin.json`; `name` required, other metadata optional. Root `mcp.json` contains `mcpServers`. Skills use `skills/<name>/SKILL.md` with `name` and `description` YAML metadata. Default component discovery is used in this package.
- https://cursor.com/docs/plugins — public marketplace review and IDE-only local testing at `~/.cursor/plugins/local`; no claim of Bot local-import parity.
- https://github.com/cursor/plugin-template — Cursor-owned repository template with single and multiple plugin layouts.

Inference: a Cursor-format marketplace package is an appropriate candidate for Grok Bot because official Bot documentation points to the shared marketplace. Explicit public documentation of the Bot's complete package parser, direct ZIP installation, and Bot local imports was not found. Keep this distinction in release copy.

## Separate surfaces

- https://docs.x.ai/grok/connectors — consumer Grok.com custom MCP path: New Connector → Custom, URL and required authentication.
- https://docs.x.ai/build/features/mcp-servers — Grok Build's native HTTP MCP OAuth configuration. This is not the Bot app.
- https://docs.x.ai/developers/tools/remote-mcp — xAI API MCP request configuration. An API client is not a person's persistent Grok Bot.

No local package import, live Grok Bot connection, OAuth handshake, marketplace submission, public repository publication, or token provisioning has been performed. No license was selected. The owner-private Accord audience remains unchanged.
