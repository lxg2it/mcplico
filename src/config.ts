import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Transport configuration for connecting to an upstream MCP server.
 */
export type TransportConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type: "sse";
      url: string;
    };

/**
 * Server configuration entry.
 */
export interface ServerConfig {
  /** Friendly name used as the tool group namespace */
  name: string;
  /** Transport to connect to this upstream server */
  transport: TransportConfig;
}

/**
 * Tool grouping override — map group names to explicit tool lists.
 */
export interface GroupOverrides {
  [groupName: string]: string[];
}

/**
 * Full MCPico configuration.
 */
export interface MCPicoConfig {
  /** Upstream MCP servers to proxy */
  servers: ServerConfig[];
  /** Separator used for prefix-based tool grouping (default: "_") */
  separator?: string;
  /** Explicit group overrides — tools not listed here are auto-grouped */
  groups?: GroupOverrides;
}

/**
 * Normalize transport config to the StdioServerParameters format.
 */
export function toStdioParams(transport: TransportConfig): StdioServerParameters {
  if (transport.type === "stdio") {
    return {
      command: transport.command,
      args: transport.args,
      env: transport.env,
      cwd: transport.cwd,
    };
  }
  throw new Error(`Transport type "${transport.type}" not yet supported`);
}
