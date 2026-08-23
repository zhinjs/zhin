# Choose a solution by outcome

You do not need to learn Zhin's package graph first. Pick the outcome you need;
each path starts with a runnable minimum and adds capabilities only when they are
useful.

| What you want to deliver | Start here | You are done when |
| --- | --- | --- |
| A bot that receives and sends messages | [IM Bot path](/en/paths/im-bot) | Sandbox and a real platform share the same command and message flow |
| A bot that understands your business | [Add governed Agent context](/en/authoring/agent-tools#give-an-agent-plugin-owned-context) | The Prompt Section is in the current generation and visible in Console |
| Tools, MCP, skills, and sub-agents | [AI Agent path](/en/paths/ai-agent) | The Agent sees only capabilities authorized for the current turn |
| Operate and diagnose a deployed bot | [Console Admin path](/en/paths/console) | You can inspect endpoints, logs, capabilities, and Agent runs |
| A personal schedule, reminder, and voice assistant | [Personal Assistant](/en/showcase/personal-assistant) | Messages, scheduled jobs, voice, and proactive delivery form one loop |
| A multi-platform community bot | [Multi-platform Bot](/en/showcase/community-bot) | Business commands and components do not depend on one adapter |

## Recommended delivery order

1. Establish a repeatable golden path in Sandbox.
2. Connect one real platform without leaking adapter details into business code.
3. Enable AI only when needed; govern prompts, tools, and authority separately.
4. Use Console to verify the generation that is actually published instead of
   treating the configuration file as runtime truth.

If you do not have a project yet, use the default IM golden path in
[Quick Start](/en/getting-started/).
