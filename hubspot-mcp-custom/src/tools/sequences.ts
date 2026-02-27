/**
 * Sequences tools: list_sequences, get_sequence_enrollments
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HubSpotClient, HubSpotApiError } from "../client.js";

function formatResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function formatError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  if (error instanceof HubSpotApiError) {
    return { content: [{ type: "text" as const, text: JSON.stringify(error.toJSON(), null, 2) }], isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

export function registerSequenceTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "list_sequences",
    "List all sales sequences. Requires Sales Hub Professional or Enterprise. Returns sequence names, IDs, and step counts. The HubSpot sequences API requires a userId — if omitted, it will be auto-resolved from the first CRM owner.",
    {
      userId: z
        .number()
        .optional()
        .describe("HubSpot user ID (owner userId). If omitted, auto-resolved from the first CRM owner via /crm/v3/owners."),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 20)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({ userId, limit, after }) => {
      try {
        let resolvedUserId = userId;
        if (resolvedUserId === undefined) {
          const owners = await client.get<{ results?: Array<{ userId?: number }> }>(
            "/crm/v3/owners",
            { limit: 1 }
          );
          resolvedUserId = owners.results?.[0]?.userId;
          if (resolvedUserId === undefined) {
            return formatError(new Error(
              "Could not auto-resolve userId: no CRM owners found. Please provide a userId explicitly."
            ));
          }
        }
        const data = await client.get(
          "/automation/v4/sequences",
          { userId: resolvedUserId, limit: limit ?? 20, after }
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_sequence_enrollments",
    "Get sequence enrollments for a specific contact. Shows which sequences a contact is/was enrolled in and their status. Requires Sales Hub Professional or Enterprise.",
    {
      contactId: z.string().describe("The contact's HubSpot ID"),
    },
    async ({ contactId }) => {
      try {
        const data = await client.get(
          `/automation/v4/sequences/enrollments/contact/${contactId}`
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
