# Accord → Instinct

Updated 2026-10-01. Status: setup prepared; actual Instinct connection unverified. No Instinct OAuth grant, connector submission or agent tool call has occurred.

## Verified provider

[Instinct](https://instinct.com/) is a personal assistant operated by Spear Street Technology, Inc. Its official homepage describes reaching an agent by text or calls and connecting applications and devices. The official account entry resolves to [Instinct sign-in](https://app.instinct.com/login).

The public [privacy policy](https://instinct.com/privacy-policy) and [terms](https://instinct.com/terms) discuss connected third-party services, including Google Workspace integrations. These do not establish inbound MCP, private custom connector registration or a public agent API. Google OAuth for Instinct's other integrations must not be treated as a contract for Accord. Plugin discovery for “Instinct” returned no matching plugin in this session; that is not an exhaustive compatibility claim.

## Current preparation

Instinct appears alongside Muse in Connections with an explicit “Connection unverified” state. “Set up Instinct” opens its official account entry, profile creation/selection, conditional verification prompt and Accord's public connection details. No Instinct credentials are collected. It does not authorize, submit, grant space access, accept terms or claim to alter provider memory.

The selector includes only the signed-in person's supplied non-revoked profiles labelled Instinct or Instinct AI. Entering from a profile's Connect control selects that exact profile; entering from the provider card requires explicit selection. The prompt checks for a supported authorized connector before attempting a call, checks the exact selected owner profile, preserves scope/version/attribution and stops on unavailable tools or failure. Browser access alone must not be recorded as a connector success.

Accord's existing MCP server is `https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/mcp`, with the same OAuth resource and public discovery at `https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/.well-known/accord.json`. Sign-in is managed by Sites. These are Accord's capabilities, not verified Instinct setup fields. The private Site audience remains unchanged.

## Next connection check

1. Inspect the consenting owner's signed-in Instinct account for a documented custom integration method. Do not infer support from its ability to use a browser.
2. If remote MCP is supported, check transport, OAuth, allowed URLs, private development access and current account availability against Accord's actual contract. If another interface is required, implement its documented adapter before claiming support.
3. Use a deliberately selected owned profile and synthetic content to verify real Instinct discovery, authorization, all inbox/guidance pages, scoped work, review and a later fresh read. A normal owner-authenticated Codex call cannot prove Instinct origin.
4. Verify denied reverse authority, expired/revoked permissions and disconnected-profile reads through the actual client. Keep private membership and recipient review in effect.

Current local tests and live Codex evidence establish their recorded environments only. Owner POC approval, two-person testing and marketplace acceptance remain outstanding.
