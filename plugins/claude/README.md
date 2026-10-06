# Accord for Claude

Use Accord from Claude to read a requested room, handle assigned work, send work through an existing permission, and propose guidance for human review. This package contains one workflow skill and a fixed remote MCP connector. It contains no executable hooks, subprocesses, embedded credentials or background worker.

The connector sends tool arguments to `https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/mcp` and returns Accord records to Claude. Depending on the requested action, these can include room context, assigned work, progress reports and guidance. OAuth authenticates the person using Accord; an Accord profile is not a separate credential or proof of provider identity. Existing Accord membership and authority checks control actions.

This is a private POC package. Packaging support is documented by Anthropic; actual Claude authorization and tool calls against Sites-managed OAuth have not yet been verified. Installing the skill alone does not establish a working connection. Do not paste account secrets into chat or the package, or replace OAuth with copied browser credentials.

## Claude chat and Cowork

1. Zip this plugin folder so `.claude-plugin/plugin.json` is at the archive root or inside its single top-level directory.
2. Open **Customize → Plugins → Add → Upload plugin** and select the archive.
3. Open the plugin's **Connectors** tab, add or connect Accord, and complete the detected OAuth sign-in.
4. Enable the connector in the intended conversation and ask Claude to read one explicitly selected synthetic room. Confirm its tools appear and a real read succeeds before using shared work.

Claude chat, Cowork and Claude Code support this fixed HTTP connector and the skill, with separate connector authorization. Organization administrators may control installation and connector availability. See Anthropic's [plugin structure and testing](https://claude.com/docs/plugins/build) and [support by surface](https://claude.com/docs/plugins/platform-support).

## Claude Code

From the Accord repository after this folder is integrated as `plugins/claude`:

```sh
claude plugin validate ./plugins/claude
claude --plugin-dir ./plugins/claude
```

Within the Claude Code session, check `/mcp` for Accord's connection state and authenticate when required. Run `/accord:accord` with the requested Accord task. Loading with `--plugin-dir` applies only to that session. Use `--strict` when supported by your CLI. Validation checks files, not live OAuth or the accuracy of results; Claude Code v2.1.281 or later additionally validates MCP entries. See the [manifest reference](https://code.claude.com/docs/en/plugins-reference) and [MCP reference](https://code.claude.com/docs/en/mcp).

## OAuth and verification

Sites manages Accord's authentication. Compatibility with Claude remains a live verification step: discover authentication, complete user consent, discover tools and perform a real requested read. Claude's [connector authentication requirements](https://claude.com/docs/connectors/building/authentication) include a proper unauthenticated challenge, matching resource metadata, PKCE and a supported client-registration path. If this fails, record the failure without weakening authentication or claiming the profile is connected.

No directory submission, listing approval or open-source license is implied by this private package. A future directory submission requires a license choice and additional review. See the [plugin submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).
