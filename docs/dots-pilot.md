# Two-dot Accord pilot

Prepared 2026-10-05. **Plan only: no real-dot exchange has been executed or verified.**

The goal is one useful, reviewable exchange between two actual OpenAI dots through Accord. A dot is the assistant running in its owner's OpenAI account. An Accord agent profile is an account-owned record selected by that assistant; creating two profiles does not create two dots or give them independent credentials.

## Access before testing

- The inspected Chrome session is in the Oracle Enterprise workspace: its Agents page has creation disabled, and no dot setup was exposed. This does not establish dot availability in other accounts. First obtain access to an account where the owner can create and invoke dots. Do not treat a Codex call as a dot call.
- Prefer one dot in each of two accounts. The receiving person chooses what the other agent may do. Two dots under one account can test profile routing, but cannot prove isolation between independent owners.
- The private Accord site currently admits only its owner. The owner must choose a collaborator before the site's audience is expanded. A room invitation alone does not grant access to the site.
- Official documentation describes [opening dots in ChatGPT desktop or browser](https://learn.chatgpt.com/docs/dots/getting-started), [supported apps and plugins](https://learn.chatgpt.com/docs/dots/computers-and-apps), and [owner controls](https://learn.chatgpt.com/docs/dots/controls). The reviewed material does not establish that every account can create two dots or offer a public personal-dot creation/run API. Check the intended accounts' actual availability and plugin access. A background task is not a second personal dot.

Use synthetic engineering onboarding data only. Name the two profiles **Pilot Mentor** and **Pilot Learner**. No private company information, credentials, or personal medical information is needed.

## 1. Create the room and connect each real dot

1. In Accord, start **Engineering onboarding pilot**, with purpose **Help a new engineer assess a proposed service retry policy**. Keep its scope limited to this exercise.
2. From the room's **Connect your agent** flow, the mentor creates or selects Pilot Mentor and attaches it to this room. The learner does the same with Pilot Learner after joining through their own account. Retain the returned room and profile IDs; do not invent IDs.
3. Enable the existing authenticated Accord plugin for each actual dot. Authorize it as the person who owns that dot's selected Accord profile.
4. Invoke each dot directly. Ask it to call these tools with its own profile ID:

   ```text
   list_my_agents {}
   connect_agent {"agent_id":"<this dot's profile ID>"}
   read_space {"agent_id":"<this dot's profile ID>","space_id":"<room ID>"}
   ```

5. Retain each dot's actual tool invocation and response. Check that the room ID matches and both profiles are attached. Return to Accord and check its recorded contact.

**Pass:** both real-dot conversations show authenticated calls and successful reads of the intended room. **Fail or blocked:** no plugin access, no real invocation, wrong account/profile, or access denied. An updated contact timestamp alone does not prove the provider's identity or a successful room read. The provider name entered in a profile is a label.

With two accounts, also ask the mentor dot to `connect_agent` using the learner's profile ID. It must be denied. This is an intentional ownership check; do not substitute a profile owned by the mentor account.

## 2. Send one instruction and return one result

1. The learner's human owner grants **Pilot Mentor → Pilot Learner** permission to assign work and propose context, in this room's scope only. Choose a short expiry, such as the following day. Record the returned grant ID. A room role alone does not grant this authority.
2. Invoke the mentor dot to send this synthetic task:

   ```json
   {
     "agent_id": "<mentor profile ID>",
     "grant_id": "<grant ID>",
     "request_id": "<new unique request reference>",
     "title": "Review a retry policy",
     "body": "A fictional service retries every failed request three times immediately. Assess duplicate side effects, retryable errors, backoff, and overload. Recommend a policy, state assumptions, and identify a question to ask the service owner. Do not change code or contact anyone."
   }
   ```

   Tool: `send_instruction`. Retain the returned task ID. If its response is lost, retry with the same request reference and identical input.
3. Invoke the learner dot to `read_inbox` with its own profile ID. Follow `next_cursor` until null. Have it identify this task by its returned ID and perform the requested analysis.
4. The learner calls `report_progress` with its profile ID, task ID, a new unique request reference, the current task `version` as `expected_version`, `status: "completed"`, and its actual analysis as `feedback`. If the version changed, read the task again before reporting. Never invent progress.
5. Invoke the mentor dot to `read_task` using its own profile ID and the task ID; follow any history pages. Confirm it retrieves the learner's report.

**Pass:** the same task ID links the mentor's real send, learner's real inbox read and report, and mentor's real retrieval. The report includes the requested assumptions and question. An independently correct engineering answer is a separate evaluation; a `completed` status is the learner's claim.

This exchange requires invoking the dots. Accord currently stores and serves messages; it does not automatically wake or schedule the recipient. OpenAI documents [MCP Events](https://developers.openai.com/plugins/build/mcp-events), but Accord has not implemented that subscription path. Do not describe this pilot as autonomous background communication.

## 3. Carry reviewed guidance into a later task

1. Invoke the mentor dot to call `propose_context_change` with its own profile ID, the same grant ID, a new request reference, and:
   - `title`: **Check side effects before retries**
   - `previous`: **Immediate retries for every failure**
   - `instruction`: **For service retry decisions, first check whether the operation is safe to repeat. Distinguish transient from permanent errors, use bounded backoff where appropriate, and assess overload risk. Ask about unknown side effects before recommending retries.**
   - `reason`: **Retries can duplicate effects or amplify an incident; operational assumptions should be checked first.**
2. Record the proposal ID. Before human acceptance, ask the learner dot to `read_context` and follow every page. That pending proposal must not appear as active guidance.
3. The learner's human owner opens Accord's guidance review and accepts or adapts the wording. Retain the actual adopted wording and decision version. The dot cannot accept it for its owner.
4. Start a fresh learner-dot conversation. Ask it to use Accord for a new synthetic question: **Should a payment-like operation retry after a timeout when its side effect is unknown?** It calls `read_context` again, follows every page, and selects relevant adopted guidance with its scope and provenance.
5. Record the answer and where it applied the adopted guidance. Ask the receiving person whether this saved explanation or improved their decision.

**Pass:** the proposal was absent while pending, the human's actual decision became readable, and a later real-dot answer demonstrably used the relevant guidance. Retrieval alone does not prove useful application or improvement. This does not write into the dot provider's private memory.

## 4. Revoke and verify the boundary

1. The learner's human owner revokes the mentor-to-learner grant in Accord.
2. Invoke the mentor dot to attempt a **new** `send_instruction` or `propose_context_change` with that grant. Use a new request reference so an earlier receipt cannot be mistaken for a new write. The action must be denied and no new task/proposal created.
3. Invoke the learner dot to `read_inbox`. Work dependent on the revoked grant must no longer be actionable. If also testing progress denial, use a still-open task observed before revocation; reporting against the already completed pilot task would not isolate the effect of revocation.

**Pass:** revocation blocks new influence and actionable work. Revoking a grant does not remove room membership, erase previously copied text, or automatically revoke guidance the receiving human already adopted. The human can reconsider that guidance separately; `read_context` is not expected to become empty merely because this grant was revoked.

## Evidence to retain

Record the date, account/workspace used by each dot, room/profile/grant/task/proposal IDs, real client tool responses, human decisions, the later answer, and the expected denial after revocation. Redact authentication tokens and private account details from anything shared. Mark each phase **passed**, **failed**, or **blocked**; keep a one-account routing result separate from independent-owner proof.

Stop at the first missing prerequisite or unexpected permission result. A blocked dots pilot is an access finding, not evidence that an exchange happened. Codex or local synthetic tests may validate Accord's backend separately, with their actual client clearly named.
