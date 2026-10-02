# Accord and ChatGPT Space

Reviewed 2026-09-30. This assessment uses current official documentation, not hands-on verification of Space or proof of demand for Accord. OpenAI lists ChatGPT Space in its [September 29, 2026 launch announcement](https://learn.chatgpt.com/docs/whats-new/devday-2026). The comparison concerns that new feature, rather than legacy Projects alone.

## Confirmed overlap

| Accord proposition | Documented OpenAI capability |
| --- | --- |
| Shared context and sources | Space groups pages and files, supports connected sources, and lets collaborators work on shared material. [Overview](https://learn.chatgpt.com/docs/space) |
| Reusable guidance | Pages include Prompt, Task, and Agent Instructions blocks. Mentor-provided guidance could live in a shared page. The documentation does not establish automatic application to every later task. [Pages](https://learn.chatgpt.com/docs/space/pages) |
| People and agents working together | ChatGPT and dots can respond to page mentions or comments and make reviewable changes. Collaborators may use different agents and instructions. [Agents in Space](https://learn.chatgpt.com/docs/space/agents) |
| Controlled sharing | View, comment, and edit roles and inherited access already exist. Sharing does not automatically expose private chats or saved memory. [Collaboration](https://learn.chatgpt.com/docs/space/collaboration), [administration](https://learn.chatgpt.com/docs/enterprise/chatgpt-space) |
| Ongoing authority | Dots support scoped ongoing instructions and custom action rules. Owners can instruct their dot to engage others in Slack. These features are not equivalent to Accord's relationship grants, but permissions alone are insufficient differentiation. [Controls](https://learn.chatgpt.com/docs/dots/controls), [messaging](https://learn.chatgpt.com/docs/dots/channels) |
| Context across products | OpenAI supports importing setup and recent work from Claude Code, Claude Cowork, and Cursor, with automatic updates available. This describes import into OpenAI, not reciprocal relationships between providers. [Import](https://learn.chatgpt.com/docs/import) |
| Externally initiated agent work | Workspace Agents accept asynchronous API triggers, conversation continuity, duplicate-safe acceptance, and beta status polling. Final response text is not available through this API. Access depends on workspace enablement and tokens; this does not establish an API for every personal dot. [Triggers](https://learn.chatgpt.com/workspace-agents/trigger-runs), [authentication](https://learn.chatgpt.com/workspace-agents/authentication) |
| Event-driven collaboration | ChatGPT supports MCP 2.0 webhook event subscriptions that can initiate user-chosen work, with expiry and access checks. External connection and waking an agent are not sufficient differentiation for Accord. [MCP Events](https://developers.openai.com/plugins/build/mcp-events) |

## Remaining hypothesis

Accord could help people let trusted others influence their personal agents within agreed boundaries while retaining their own provider and control over adopted guidance. Mentorship, onboarding, consulting, coaching, teaching, and other relationships can share this model.

The reviewed documentation does not establish native Space participation by Claude, Muse, Instinct, or OpenClaw agents; recipient-issued authority between independently owned agents across providers; or portable relationship-specific approval and provenance. This is a documentation boundary, not proof those capabilities are absent. Human sharing options depend on account and workspace; do not claim Space excludes outside people.

## Prototype limitations

Accord already records directional grants, expiry, revocation, and recipient context decisions. It authenticates people; profiles are not independently credentialed agents. External assistants must invoke its tools: Accord does not wake them or alter another provider's private memory. Cross-provider delivery, later use of accepted guidance, and improved outcomes remain unverified. Revocation blocks new authorized exchanges; it cannot recall information already delivered or silently erase owner-adopted guidance.

## Recommendation

Pause expansion of generic workspace features. A shared room with agent instructions and review is substantially overlapped by Space. Test the relationship exchange across providers before claiming differentiation or committing to broader orchestration. Space may become a source or interface for Accord rather than something users must replace. This is a validation priority, not a restriction to one profession or a committed product pivot.

## Five-pair validation test

Run a one-week pilot with five existing relationships whose participants use different agent products. Compare the strongest native workflow available to each pair—including Space pages, scoped dot instructions, and supported event automation where enabled, as well as manual transfer—with one Accord loop: propose guidance, obtain recipient approval, verify its use in a later real task, and withdraw permission to confirm new exchanges stop. Use only integrations actually verified during the pilot.

Record setup effort, repeated explanation, actual reuse, and voluntary repeat use. As an initial decision gate, advance if at least three pairs independently choose to repeat Accord's flow and identify a concrete benefit over the baseline. This small test guides the next investment; it does not establish market demand. If existing tools or a lightweight connector suffice, ship the smallest useful integration instead of requiring another workspace. Preserve the broad relationship ambition; test one concrete recurring exchange first.

## Event integration boundary

MCP Events requires treating user-authored event content as data rather than behavioral instructions. A future Accord subscription should notify an authorized recipient that guidance is available for review and link to its source; it must not present a third party’s proposal as overriding authority. Subscriber instructions and receiving-owner decisions retain control. This is a future integration constraint, not a capability already implemented by Accord. [Event payload guidance](https://developers.openai.com/plugins/build/mcp-events)
