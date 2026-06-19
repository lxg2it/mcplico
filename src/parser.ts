/**
 * Result of parsing a command string.
 */
export interface ParsedCommand {
  /** The subcommand name (maps to an upstream tool name) */
  subcommand: string | null;
  /** Parsed arguments to pass to the upstream tool */
  args: Record<string, unknown>;
  /** Whether this is a help request */
  isHelp: boolean;
  /** Error message if parsing failed */
  error: string | null;
}

/**
 * Parse a command string from the model.
 *
 * Format: `<subcommand> <json_args>`
 *
 * - Empty string or "help" → isHelp = true
 * - "read_file" → subcommand = "read_file", args = {}
 * - 'read_file {"path":"/etc/hosts"}' → subcommand = "read_file", args = {path: "/etc/hosts"}
 * - "list_dir" → subcommand = "list_dir", args = {}
 *
 * Error handling:
 * - If JSON is malformed, returns error message
 * - If no subcommand given, returns isHelp = true
 */
export function parseCommand(rawCommand: string): ParsedCommand {
  const trimmed = rawCommand.trim();

  // Empty or explicit help
  if (!trimmed || trimmed === "help") {
    return { subcommand: null, args: {}, isHelp: true, error: null };
  }

  // Find the first space to split subcommand from args
  const spaceIdx = trimmed.indexOf(" ");

  if (spaceIdx === -1) {
    // No args — just a subcommand
    return {
      subcommand: trimmed,
      args: {},
      isHelp: trimmed === "help",
      error: null,
    };
  }

  const subcommand = trimmed.slice(0, spaceIdx).trim();
  const argsStr = trimmed.slice(spaceIdx + 1).trim();

  // Empty args after subcommand
  if (!argsStr) {
    return { subcommand, args: {}, isHelp: false, error: null };
  }

  // Try JSON parse
  try {
    const args = JSON.parse(argsStr);
    if (typeof args !== "object" || Array.isArray(args)) {
      return {
        subcommand,
        args: {},
        isHelp: false,
        error: "Arguments must be a JSON object, e.g. {\"key\":\"value\"}",
      };
    }
    return { subcommand, args: args as Record<string, unknown>, isHelp: false, error: null };
  } catch {
    return {
      subcommand,
      args: {},
      isHelp: false,
      error: `Could not parse arguments as JSON: "${argsStr}". Use format: <subcommand> {"key":"value",...}`,
    };
  }
}
