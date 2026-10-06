# Agent exchange pilot

Updated 2026-10-05. The initial plan was two test OpenAI dots. The owner has chosen an existing personal dot and **Meta Muse** as the second peer, using a Muse task to operate Accord's website. **One real-dot connection is verified; Muse reached Accord's sign-in wall and is waiting for human sign-in. The peer exchange remains unexecuted.** No new test dot was created.

The goal is one useful, reviewable exchange between actual personal agents through Accord. An Accord agent profile is an account-owned record selected by an assistant; creating two profiles does not create two assistants or give them independent credentials.

## Verified dot connection

In Chrome, the owner's existing personal OpenAI dot returned `list_my_agents`, `connect_agent` with `connected: true`, and a successful `read_space` for:

- Profile: `POC Recipient · Oct 1`, ID `298a9896-344d-45bc-b2b9-470d9f895544`.
- Room: `POC Verification · Oct 1`, ID `c8752e73-414c-4fad-85ba-31f4cc81c0ca`.
- Private Site version 29; source `86ddfc1f7e08db854c6452a31b7d86fb8f3ec475`; successful deployment `appgdep_6ac4494f0c048191bbd5ca92a99e1699`.

Codex tool calls stopped at 6:07 p.m. Pacific; after the dot check, Chrome showed a new profile contact at 6:10 p.m. The actual dot's returned calls are the connection evidence; the timestamp alone is not provider attestation. The returned room contained two profiles, including a revoked synthetic advisor that cannot serve as the new peer.

This check did not grant authority, exchange work with a second agent, review new guidance, or test later reuse. It also did not prove independent-owner isolation. Switching to the personal account resolved the earlier Oracle Enterprise workspace inspection; that inspection did not establish general dot unavailability.

At 6:17 p.m. Pacific, the [Accord browser access test](https://muse.ai/thread/f919e4af-39ae-47b4-a4bd-7c4ff63f8af0) side chat in signed-in consumer Muse received **Open Accord test session**, a bounded browser task to open that exact POC room and read only its name and profile names. It was instructed to stop for human sign-in if needed and prohibited permission changes or writes.

Muse's browser returned **Waiting for you · Sign-in required to view room**, showing Accord's private sign-in page and **Continue with ChatGPT**. The preview was opened in Chrome for a human takeover. The owner explicitly authorized private Accord account access in Muse's browser; human sign-in is still pending. The task is room-limited, while the signed-in account can access its other spaces. No authenticated room data was read, no writes occurred, and no Muse MCP call or peer exchange happened. This side chat and task are not a newly created independent personal-agent identity.

## Access before testing

- The owner is signed in to consumer Muse. The chosen browser task reached Accord's sign-in page; authenticated room access, writes and retrieval of the dot's response remain unverified. Directory approval is not a prerequisite for this browser pilot. Resume only after the supported human sign-in handoff. See [Muse preparation](muse-connection.md).
- Prefer one agent owned by each of two people for a permissions pilot. The receiving person chooses what the other agent may do. A dot and Muse connected as one Accord account can test provider interoperability, but cannot prove isolation between independent owners.
- The private Accord site currently admits only its owner. The owner must choose a collaborator before the site's audience is expanded. A room invitation alone does not grant access to the site.
- Official documentation describes [opening dots in ChatGPT desktop or browser](https://learn.chatgpt.com/docs/dots/getting-started), [supported apps and plugins](https://learn.chatgpt.com/docs/dots/computers-and-apps), and [owner controls](https://learn.chatgpt.com/docs/dots/controls). The reviewed material does not establish that every account can create two dots or offer a public personal-dot creation/run API. Check the intended accounts' actual availability and plugin access. A background task is not a second personal dot.

Use synthetic engineering onboarding data only. For the remaining plan, Muse is the mentor and the dot is the learner; their humans retain control. No private company information, credentials, or personal medical information is needed.

## 1. Prepare the real Muse peer

1. Choose a synthetic room for the exercise. The verified POC room and learner profile can be reused if current access and scope remain suitable; otherwise start **Engineering onboarding pilot**, with purpose **Help a new engineer assess a proposed service retry policy**.
2. Create or select a nonrevoked mentor profile and attach it to the chosen room. Do not reuse the revoked synthetic advisor. With two people, the mentor joins with their own sign-in email and both site and room access; each owner attaches their own profile. Retain the returned IDs. A profile does not connect Muse by itself.
3. Create a bounded task in actual consumer Muse to open the Accord room at `/sessions/<room-id>` and use the site's controls for this exercise. If its browser needs sign-in or approval, stop at that step for the owner's supported interaction. Preserve Sites-managed authentication; do not copy tokens or substitute Codex actions for Muse's browser actions.
4. Retain Muse's actual browser task, the authenticated room it opened, and its visible room read. If the dot's selected room or profile changed, verify its actual MCP read of the new room too.

**Pass:** actual Muse browser evidence and actual dot MCP responses identify the same authorized room. **Fail or blocked:** the private website is inaccessible, sign-in cannot complete, the room is wrong, or no real Muse task runs. A successful Muse account login alone is not this test. A profile timestamp or provider label cannot prove the browser activity.

This route does not claim a Muse MCP connection. Website actions use Accord's human API and are recorded as person-submitted actions; real Muse task evidence identifies who operated that browser. Independent-owner isolation needs two owners and separate account-bound access checks.

## 2. Send one instruction and return one result

1. The dot's human owner grants **Muse mentor → dot learner** permission to assign work and propose context, in this room's scope only. Choose a short expiry, such as the following day. Record the returned grant ID. A room role alone does not grant this authority.
2. Have the real Muse browser task use **Assign work** and choose the permitted mentor-to-dot direction. Enter:
   - Task: **Review a retry policy**
   - Instruction: **A fictional service retries every failed request three times immediately. Assess duplicate side effects, retryable errors, backoff, and overload. Recommend a policy, state assumptions, and identify a question to ask the service owner. Do not change code or contact anyone.**
   Retain the saved task ID and Muse's actual browser action. If the result is uncertain, check the saved record before retrying; the still-open form retains its request reference for identical input. Do not claim an MCP `send_instruction` call from Muse.
3. Invoke the learner dot to `read_inbox` with its own profile ID. Follow `next_cursor` until null. Have it identify this task by its returned ID and perform the requested analysis.
4. The learner calls `report_progress` with its profile ID, task ID, a new unique request reference, the current task `version` as `expected_version`, `status: "completed"`, and its actual analysis as `feedback`. If the version changed, read the task again before reporting. Never invent progress.
5. Have Muse return to the room's **Shared work**, open that task, and retrieve the dot's actual report and history. Record its real browser read against the same task ID.

**Pass:** the same task ID links the mentor's real send, learner's real inbox read and report, and mentor's real retrieval. The report includes the requested assumptions and question. An independently correct engineering answer is a separate evaluation; a `completed` status is the learner's claim.

This exchange requires invoking the assistants. Accord currently stores and serves messages; it does not automatically wake or schedule the recipient. OpenAI documents [MCP Events](https://developers.openai.com/plugins/build/mcp-events), but Accord has not implemented that subscription path. Do not describe this pilot as autonomous background communication.

## 3. Carry reviewed guidance into a later task

1. Have the real Muse browser task use **Context changes → Propose change**, choose the permitted mentor-to-dot direction, and enter:
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
2. Have Muse try a **new** assignment or proposal through the website. The revoked direction must be unavailable or rejected, with no new task/proposal created. Record the actual browser result. A recovered earlier receipt is not a new write.
3. Invoke the learner dot to `read_inbox`. Work dependent on the revoked grant must no longer be actionable. If also testing progress denial, use a still-open task observed before revocation; reporting against the already completed pilot task would not isolate the effect of revocation.

**Pass:** revocation blocks new influence and actionable work. Revoking a grant does not remove room membership, erase previously copied text, or automatically revoke guidance the receiving human already adopted. The human can reconsider that guidance separately; `read_context` is not expected to become empty merely because this grant was revoked.

## Evidence to retain

Record the date, account/workspace and actual client used by each assistant, room/profile/grant/task/proposal IDs, real client tool responses, human decisions, the later answer, and the expected denial after revocation. Redact authentication tokens and private account details from anything shared. Mark each phase **passed**, **failed**, or **blocked**; keep one-account provider interoperability separate from independent-owner proof.

Stop at the first missing prerequisite or unexpected permission result. A blocked Muse browser task is an access finding, not evidence that an exchange happened. Codex or local synthetic tests may validate Accord's backend separately, with their actual client clearly named.
