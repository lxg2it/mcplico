import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { TransportConfig } from "./config.js";

/**
 * Tool metadata from an upstream MCP server.
 */
export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Resource metadata from an upstream MCP server.
 */
export interface UpstreamResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Prompt metadata from an upstream MCP server.
 */
export interface UpstreamPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * Discovered upstream server with its tools, resources, and prompts.
 */
export interface DiscoveredServer {
  name: string;
  tools: UpstreamTool[];
  resources: UpstreamResource[];
  prompts: UpstreamPrompt[];
  client: Client;
  transport: StdioClientTransport;
}

/**
 * Connect to an upstream MCP server and discover its tools.
 */
export async function discoverServer(
  name: string,
  transportConfig: TransportConfig
): Promise<DiscoveredServer> {
  const transport = new StdioClientTransport({
    command: transportConfig.type === "stdio" ? transportConfig.command : "",
    args: transportConfig.type === "stdio" ? transportConfig.args : [],
    env: transportConfig.type === "stdio" ? transportConfig.env : undefined,
    cwd: transportConfig.type === "stdio" ? transportConfig.cwd : undefined,
  });

  const client = new Client(
    { name: `MCPico-${name}`, version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Discover tools
  const toolsResult = await client.listTools();
  const tools: UpstreamTool[] = (toolsResult.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) || {},
  }));

  // Discover resources (if supported)
  let resources: UpstreamResource[] = [];
  try {
    const resResult = await client.listResources();
    resources = (resResult.resources || []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  } catch {
    // Resources may not be supported by this server
  }

  // Discover prompts (if supported)
  let prompts: UpstreamPrompt[] = [];
  try {
    const promptResult = await client.listPrompts();
    prompts = (promptResult.prompts || []).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: (p.arguments || []).map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required,
      })),
    }));
  } catch {
    // Prompts may not be supported by this server
  }

  return { name, tools, resources, prompts, client, transport };
}

/**
 * Disconnect from an upstream server.
 */
export async function disconnectServer(server: DiscoveredServer): Promise<void> {
  await server.client.close();
}
