import { initConfig, loadSettings } from "../config";
import { getAgentPaths } from "../paths";
import { resetSession, peekSession } from "../sessions";

const USAGE = `Usage: claudeclaw agents <subcommand>

Subcommands:
  list              List all configured agents
  show <id>         Show config and workspace paths for an agent
  reset <id>        Clear the session for an agent
`;

export async function agents(args: string[]) {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  await initConfig();
  const settings = await loadSettings();

  // Build the full agent roster: 'main' always first, then explicit list
  const mainEntry = { id: "main", name: "main", workspace: undefined as string | undefined };
  const roster = [mainEntry, ...settings.agents.list];

  function findAgent(id: string) {
    if (id === "main") return mainEntry;
    return settings.agents.list.find((a) => a.id === id) ?? null;
  }

  function validIds() {
    return roster.map((a) => a.id).join(", ");
  }

  if (sub === "list") {
    console.log(`Configured agents (default: ${settings.agents.default}):\n`);
    for (const agent of roster) {
      const paths = getAgentPaths(agent.id, agent.workspace);
      const label = agent.name ? ` (${agent.name})` : "";
      const tag = agent.id === settings.agents.default ? " [default]" : "";
      console.log(`  ${agent.id}${label}${tag}`);
      console.log(`    workspace: ${paths.workspaceDir}`);
    }
    return;
  }

  if (sub === "show") {
    const id = args[1];
    if (!id) {
      console.error("Usage: claudeclaw agents show <id>");
      process.exit(1);
    }
    const agent = findAgent(id);
    if (!agent) {
      console.error(`Unknown agent: "${id}". Available: ${validIds()}`);
      process.exit(1);
    }

    const paths = getAgentPaths(id, agent.workspace);
    const session = await peekSession(id);

    console.log(`Agent: ${id}`);
    if (agent.name) console.log(`  name:          ${agent.name}`);
    if (agent.systemPrompt) console.log(`  systemPrompt:  ${agent.systemPrompt}`);
    console.log(`\nWorkspace paths:`);
    console.log(`  workspaceDir:    ${paths.workspaceDir}`);
    console.log(`  agentsMd:        ${paths.agentsMd}`);
    console.log(`  soulMd:          ${paths.soulMd}`);
    console.log(`  memoryMd:        ${paths.memoryMd}`);
    console.log(`  memoryDir:       ${paths.memoryDir}`);
    console.log(`  sessionFile:     ${paths.sessionFile}`);
    console.log(`  memoryMcpConfig: ${paths.memoryMcpConfig}`);
    console.log(`  mcpConfig:       ${paths.mcpConfig}`);
    console.log(`\nSession:`);
    if (session) {
      console.log(`  id:          ${session.sessionId}`);
      console.log(`  createdAt:   ${session.createdAt}`);
      console.log(`  lastUsedAt:  ${session.lastUsedAt}`);
    } else {
      console.log(`  (none)`);
    }
    return;
  }

  if (sub === "reset") {
    const id = args[1];
    if (!id) {
      console.error("Usage: claudeclaw agents reset <id>");
      process.exit(1);
    }
    const agent = findAgent(id);
    if (!agent) {
      console.error(`Unknown agent: "${id}". Available: ${validIds()}`);
      process.exit(1);
    }

    await resetSession(id);
    console.log(`Session cleared for agent "${id}".`);
    return;
  }

  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(USAGE);
  process.exit(1);
}
