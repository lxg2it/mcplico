import type { GroupOverrides } from "./config.js";
import type { UpstreamTool } from "./discoverer.js";

/**
 * A group of related tools from an upstream server.
 */
export interface ToolGroup {
  /** Group name (e.g., "filesystem") */
  groupName: string;
  /** Source server name */
  serverName: string;
  /** Tools in this group */
  tools: UpstreamTool[];
}

/**
 * Extract the prefix from a tool name using the given separator.
 * Returns null if no prefix detected.
 */
function extractPrefix(
  toolName: string,
  separator: string
): string | null {
  const idx = toolName.indexOf(separator);
  if (idx <= 0) return null;
  const prefix = toolName.slice(0, idx);
  // Must have a non-empty suffix too
  if (idx >= toolName.length - 1) return null;
  return prefix;
}

/**
 * Group tools from an upstream server by prefix.
 *
 * Strategy:
 * 1. If explicit group overrides exist, apply them first.
 * 2. For remaining tools, extract prefix using separator.
 * 3. Tools without a prefix go into the server's default group.
 */
export function groupTools(
  serverName: string,
  tools: UpstreamTool[],
  separator: string = "_",
  overrides?: GroupOverrides
): ToolGroup[] {
  const groups = new Map<string, UpstreamTool[]>();
  const ungrouped: UpstreamTool[] = [];

  // Build override lookup: toolName → forcedGroupName
  const overrideMap = new Map<string, string>();
  if (overrides) {
    for (const [group, toolNames] of Object.entries(overrides)) {
      for (const tn of toolNames) {
        overrideMap.set(tn, group);
      }
    }
  }

  for (const tool of tools) {
    // Check explicit override
    const forcedGroup = overrideMap.get(tool.name);
    if (forcedGroup) {
      const existing = groups.get(forcedGroup) || [];
      existing.push(tool);
      groups.set(forcedGroup, existing);
      continue;
    }

    // Try prefix extraction
    const prefix = extractPrefix(tool.name, separator);
    if (prefix) {
      const existing = groups.get(prefix) || [];
      existing.push(tool);
      groups.set(prefix, existing);
    } else {
      ungrouped.push(tool);
    }
  }

  // Tools without a prefix or override go into their own group per server
  const result: ToolGroup[] = [];
  for (const [groupName, groupTools] of groups) {
    result.push({ groupName, serverName, tools: groupTools });
  }

  if (ungrouped.length > 0) {
    // Put ungrouped tools in a group named after the server
    result.push({
      groupName: serverName,
      serverName,
      tools: ungrouped,
    });
  }

  return result;
}
