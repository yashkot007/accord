# Accord for Grok Bot — marketplace candidate

This folder uses the documented Cursor plugin format for a candidate intended for the shared Cursor/Grok Bot marketplace. It contains the existing Accord remote MCP endpoint and one workflow skill. It is not an approved marketplace listing, installed Grok Bot connector, or verified OAuth integration.

## Package

- `.cursor-plugin/plugin.json`: plugin metadata.
- `mcp.json`: remote HTTPS MCP server configuration, using standard root-file discovery.
- `skills/accord/SKILL.md`: explicit profile, room, work, guidance, and verification workflow.

The package contains no credentials, authentication bypasses, local processes, hooks, or permission grants. Accord remains private; a compatible authenticated identity flow must succeed before its tools can access user data. The endpoint's presence does not prove cross-provider authentication support.

## Personal Grok Bot setup

For a private test, ask your Grok Bot to add Accord as a custom Remote HTTPS MCP server at:

`https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/mcp`

Use the app's custom server controls if available. Complete any legitimate browser authentication yourself. If the current Sites-managed authentication is unsupported, stop; do not supply a website cookie, Sites bypass token, or invented shared API key. After connection, confirm actual tools by running `list_my_agents`, then `connect_agent` and `read_space` with a profile and room explicitly chosen by the person. No live account setup was performed when this candidate was created.

Grok Bot's published Team Bot setup supports Plugins → Add plugins → Add custom, with Remote HTTPS and per-person OAuth where the server offers it. Personal custom servers belong to the installing account. The exact personal UI depends on the installed version and must be checked before presenting a one-click instruction. Do not infer a working Grok Bot connection from success in Grok.com or Grok Build.

## Marketplace publication

Cursor's authoring documentation requires a public Git repository and review through `https://cursor.com/marketplace/publish`. The Accord product repository is currently private. Keep it private. A separately authorized public package repository, selected open-source terms, functioning authentication, and live verification are needed before submission. This candidate does not choose a license or submit an application.

Once accepted and visible in Grok Bot's Marketplace, users add the plugin, authenticate with their own account, and attach it with `@`. Availability of arbitrary candidate packages in Grok Bot is not established by local Cursor IDE testing.

## Local testing scope

Cursor IDE supports a candidate under `~/.cursor/plugins/local/accord` followed by reload when imports are allowed. That path is documented for the IDE, not for Grok Bot. No official direct Bot ZIP import or local-plugin directory was found. This package should not be described as an immediately installable Bot ZIP.

See [research notes](RESEARCH.md) for the primary sources and evidence boundaries.
