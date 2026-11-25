# Building with saga a2ui

## IASER — Ansari

[IASER](https://iaser.ai/) is the team behind [Ansari](https://askansari.ai), an AI assistant for questions about Islam. Its [production MCP app](https://github.com/iaser-ai/ansari/tree/main/apps/mcp) uses the saga a2ui React MCP stack to bring Ansari answers into assistant conversations. The [FaithfulCard component](docs/react-consumers.md#one-stack-plus-react) displays Ansari’s answer directly, preserving its Markdown formatting and source attribution.

To try it in a host that supports custom MCP connections, add `https://mcp.askansari.ai/mcp` with no authentication and ask “What does Assalamu alaikum mean?” In a November 24, 2026 test, the production app rendered a Faithful Card in ChatGPT Work on the web and in Claude Desktop.

**ChatGPT Work on the web**

![Ansari’s Faithful Card explaining the greeting in ChatGPT Work, with source attribution](docs/images/ansari-production-chatgpt-work.png)

**Claude Desktop**

![Ansari’s Faithful Card explaining the greeting in Claude Desktop, with source attribution](docs/images/ansari-production-claude-desktop.png)

## Share what you are building

Using saga a2ui in your application? [Open a pull request](CONTRIBUTING.md) with your team or project name, a public link, and a short description of what you are building with it.
