import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { MCPicoConfig } from "./config.js";
import {
  discoverServer,
  disconnectServer,
  type DiscoveredServer,
} from "./discoverer.js";
import { groupTools, type ToolGroup } from "./grouper.js";
import { parseCommand } from "./parser.js";
import { generateHelpText } from "./help.js";
import { forwardToolCall } from "./proxy.js";

/** Helper: create a simple text content result */
function textResult(text: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Start the MCPico proxy server.
 *
 * 1. Connect to all upstream servers
 * 2. Discover and group their tools
 * 3. Register grouped tools on the MCPico server
 * 4. Listen for client connections
 */
export async function startServer(config: MCPicoConfig): Promise<void> {
  const separator = config.separator || "_";
  const servers: DiscoveredServer[] = [];
  const allGroups: ToolGroup[] = [];

  // Connect to all upstream servers and discover tools
  console.error(`MCPico starting with ${config.servers.length} upstream server(s)...`);

  for (const serverConfig of config.servers) {
    try {
      console.error(`  Connecting to "${serverConfig.name}"...`);
      const discovered = await discoverServer(
        serverConfig.name,
        serverConfig.transport
      );
      servers.push(discovered);

      const groups = groupTools(
        serverConfig.name,
        discovered.tools,
        separator,
        config.groups
      );

      console.error(
        `  → ${discovered.tools.length} tools → ${groups.length} groups: ${groups.map((g) => g.groupName).join(", ")}`
      );

      allGroups.push(...groups);
    } catch (err) {
      console.error(
        `  Failed to connect to "${serverConfig.name}":`,
        (err as Error).message
      );
    }
  }

  if (servers.length === 0) {
    console.error("No upstream servers connected. Exiting.");
    process.exit(1);
  }

  // Build lookup: groupName → ToolGroup (merged across servers)
  // If two servers have tools in the same group, merge them.
  const mergedGroups = new Map<string, ToolGroup>();
  for (const group of allGroups) {
    const existing = mergedGroups.get(group.groupName);
    if (existing) {
      existing.tools.push(...group.tools);
      // Append server name
      if (!existing.serverName.includes(group.serverName)) {
        existing.serverName += ` + ${group.serverName}`;
      }
    } else {
      mergedGroups.set(group.groupName, { ...group });
    }
  }

  // Create the MCPico server
  const server = new McpServer(
    { name: "MCPico", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "MCPico bundles upstream MCP tools into hierarchical groups. " +
        "Use 'help' on any group to discover available subcommands. " +
        "Format: <subcommand> {\"key\":\"value\",...}",
    }
  );

  // Register each group as a tool
  for (const [groupName, group] of mergedGroups) {
    const toolCount = group.tools.length;
    const description = [
      `MCPico ${groupName} — ${toolCount} tool${toolCount === 1 ? "" : "s"}`,
      `Source: ${group.serverName}`,
      `Use 'help' to see all subcommands and their parameters.`,
      `Format: <subcommand> {"key":"value",...}`,
    ].join(" | ");

    // Pre-generate help text (cached)
    const helpText = generateHelpText(group);

    server.registerTool(
      groupName,
      {
        title: `MCPico: ${groupName}`,
        description,
        inputSchema: {
          command: z.string().describe(
            `Use 'help' for full docs or '<subcommand> {"key":"value",...}' to execute a tool. ` +
            `${toolCount} subcommand${toolCount === 1 ? "" : "s"} available.`
          ),
        },
      },
      async (args: { command: string }) => {
        const parsed = parseCommand(args.command);

        // Help request
        if (parsed.isHelp) {
          return textResult(helpText);
        }

        // Parse error
        if (parsed.error) {
          return textResult(parsed.error);
        }

        // Validate subcommand exists
        const toolName = parsed.subcommand!;
        const upstreamTool = group.tools.find((t) => t.name === toolName);
        if (!upstreamTool) {
          const available = group.tools.map((t) => t.name).join(", ");
          return textResult(
            `Unknown subcommand: "${toolName}"\n\nAvailable in ${groupName}: ${available}\n\nUse 'help' for full documentation.`
          );
        }

        // Find which upstream server has this tool
        // Note: if multiple servers have the same tool name (merged groups),
        // we use the first one that has it.
        const serverForTool = servers.find((s) =>
          s.tools.some((t) => t.name === toolName)
        );

        if (!serverForTool) {
          return textResult(
            `Internal error: could not find upstream server for tool "${toolName}"`
          );
        }

        // Forward the call
        try {
          const result = await forwardToolCall(
            serverForTool,
            toolName,
            parsed.args
          );
          return result;
        } catch (err) {
          return textResult(
            `Error calling "${toolName}": ${(err as Error).message}`
          );
        }
      }
    );

    console.error(`  Registered group: ${groupName} (${toolCount} tools)`);
  }

  // Pass through resources from all upstream servers
  let resourceCount = 0;
  for (const upstream of servers) {
    for (const res of upstream.resources) {
      // Namespace URI to avoid collisions: mcplico://serverName/uri
      const namespacedUri = `mcplico://${upstream.name}/${res.uri}`;
      const displayName = `${upstream.name}: ${res.name}`;

      server.registerResource(
        displayName,
        namespacedUri,
        {
          description: `${res.description || res.name} (from ${upstream.name})`,
          mimeType: res.mimeType,
        },
        async () => {
          const result = await upstream.client.readResource({ uri: res.uri });
          return {
            contents: result.contents || [],
          };
        }
      );
      resourceCount++;
    }
  }

  // Pass through prompts from all upstream servers
  let promptCount = 0;
  for (const upstream of servers) {
    for (const prompt of upstream.prompts) {
      const namespacedName = `${upstream.name}_${prompt.name}`;

      // Build args schema from prompt argument definitions
      const argShape: Record<string, ReturnType<typeof z.string>> = {};
      for (const arg of prompt.arguments || []) {
        argShape[arg.name] = z.string().describe(
          arg.description || `Argument: ${arg.name}${arg.required ? " (required)" : ""}`
        );
      }

      server.registerPrompt(
        namespacedName,
        {
          title: `${upstream.name}: ${prompt.name}`,
          description: `${prompt.description || ""} (from ${upstream.name})`,
          argsSchema: Object.keys(argShape).length > 0 ? argShape : undefined,
        },
        async (args) => {
          // Convert structured args back to Record<string,string>
          const promptArgs: Record<string, string> = {};
          if (args && typeof args === "object") {
            for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
              promptArgs[k] = String(v);
            }
          }
          const result = await upstream.client.getPrompt({
            name: prompt.name,
            arguments: promptArgs,
          });
          return {
            messages: result.messages || [],
          };
        }
      );
      promptCount++;
    }
  }

  if (resourceCount > 0) {
    console.error(`  Registered ${resourceCount} resource(s)`);
  }
  if (promptCount > 0) {
    console.error(`  Registered ${promptCount} prompt(s)`);
  }

  // Connect to client via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `MCPico ready — ${mergedGroups.size} group(s), ${servers.length} upstream server(s)`
  );

  // Handle shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("Shutting down...");
    for (const s of servers) {
      await disconnectServer(s);
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
