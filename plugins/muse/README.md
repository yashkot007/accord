# Accord for consumer Meta Muse

Prepared October 5, 2026. This folder contains setup instructions for Muse's documented Custom Connector route. It is not an installable Muse plugin manifest, a reviewed directory listing, or evidence of native Muse authorization.

## Connection details

- Product: Accord.
- Website: https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site
- Remote MCP endpoint: https://margin-context-mentorship.yashwant7kotipalli.chatgpt.site/mcp
- Current server: stateless Streamable HTTP POST; MCP versions `2025-11-25` and `2025-06-18`.
- Authentication: Sites-managed account authentication. The authenticated identity is a person; an Accord profile is not a separately credentialed agent.
- Current access: the Site is private to its owner. These instructions do not expand its audience, add reviewers, or authorize another person's data.

Muse must support the endpoint's transport and account authorization before this native route can work. The public Muse documentation does not specify the custom connector's MCP transport/version, OAuth discovery, client-registration or callback contract. Compatibility with Sites-managed authorization remains unverified. Do not invent those settings or replace authentication with copied credentials.

## Private setup

Give Muse the contents of `setup-prompt.txt`. Muse's official help describes asking it to create a Custom Connector when a service is absent from its connector list. Use Muse's secure connection and account authorization flow if it supports Accord's remote MCP service. A required sign-in or consent step belongs in that secure flow, with the owner completing it.

Stop if native remote MCP or the authentication flow is unsupported. The setup text does not create an API key, OAuth client, token, provider registration or marketplace entry. Never copy browser cookies or credentials into a prompt. Browser operation remains a separate path that requires its own appropriate account-access permission.

After a genuine native connection, discover owned profiles and let the owner select one. Then let the owner choose the intended room and task. Profile connection does not grant directional authority. Reading guidance does not approve it, update Muse's private memory or authorize future work.

## What has been proved

On October 5, actual consumer Muse used the authenticated Accord room in local Chrome to assign synthetic work. An actual OpenAI dot retrieved and answered it through Accord MCP, and Muse read the saved response in Chrome. The temporary work-only grant was revoked. That manually invoked exchange used one Accord owner.

The Chrome pilot does not prove native Muse MCP/OAuth authorization, independent-owner isolation, automatic wake-up or persistent learning. This package must retain the status **Native Muse authorization unverified** until a real native authorization and tool exchange are observed.

## Official references

- [How Muse works with Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/): consumer Custom Connectors can be created by asking Muse; they are unreviewed. Connection credentials are kept in Muse's Secure Credentials Store.
- [Muse Connector guidelines](https://muse.ai/platform/docs): reviewed connectors require documented authentication, API/MCP tools, permissions, data practices and reviewer access.
- [Muse Connector Platform](https://muse.ai/platform): approved connectors become available in its directory after review.

These references describe consumer Muse. Muse Code and Meta Model API documentation do not establish compatibility with a person's consumer Muse agent.
