/**
 * List tools: search_lists, get_list_memberships
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

export function registerListTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "search_lists",
    "Search HubSpot lists by name. Returns list names, IDs, types (DYNAMIC/MANUAL/SNAPSHOT), and sizes. Useful for finding lists associated with marketing events, webinar registrations, etc.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query to filter lists by name"),
      count: z
        .number()
        .optional()
        .describe("Max results to return (default 20, max 100)"),
      offset: z
        .number()
        .optional()
        .describe("Offset for pagination"),
    },
    async ({ query, count, offset }) => {
      try {
        const body: Record<string, unknown> = {
          count: count ?? 20,
        };
        if (query) {
          body.query = query;
        }
        if (offset !== undefined) {
          body.offset = offset;
        }
        const data = await client.post("/crm/v3/lists/search", body);
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_list_memberships",
    "Get contact IDs that are members of a HubSpot list. Returns recordId values (contact IDs) with pagination. Use search_lists first to find the list ID.",
    {
      listId: z
        .string()
        .describe("The HubSpot list ID (ILS list ID)"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return per page (default 100, max 250)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({ listId, limit, after }) => {
      try {
        const data = await client.get(
          `/crm/v3/lists/${listId}/memberships`,
          { limit: limit ?? 100, after }
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
