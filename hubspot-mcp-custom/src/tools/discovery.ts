/**
 * Discovery tools: list_pipelines, list_properties, list_owners, list_custom_object_schemas
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

export function registerDiscoveryTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "list_pipelines",
    "List all pipelines and their stages for a given object type (deals, tickets). Returns pipeline names, stage names, and their internal IDs. Use this FIRST before searching by pipeline or stage.",
    {
      objectType: z
        .enum(["deals", "tickets"])
        .describe("Object type to list pipelines for"),
    },
    async ({ objectType }) => {
      try {
        const data = await client.get(`/crm/v3/pipelines/${objectType}`);
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "list_properties",
    "List all property definitions for a CRM object type. Returns property names, types, descriptions, and enumeration options. Use this to discover what fields are available before searching.",
    {
      objectType: z
        .string()
        .describe(
          "CRM object type (contacts, companies, deals, tickets, etc.)"
        ),
    },
    async ({ objectType }) => {
      try {
        const data = await client.get(
          `/crm/v3/properties/${objectType}`
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "list_owners",
    "List all HubSpot users/owners with their IDs, names, and email addresses. Owner IDs are used in the hubspot_owner_id property on CRM objects.",
    {
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
      email: z
        .string()
        .optional()
        .describe("Filter owners by email address"),
    },
    async ({ limit, after, email }) => {
      try {
        const data = await client.get("/crm/v3/owners", {
          limit: limit ?? 100,
          after,
          email,
        });
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "list_custom_object_schemas",
    "List all custom object type definitions (schemas) in the portal. Returns object type names, properties, and association definitions.",
    {},
    async () => {
      try {
        const data = await client.get("/crm/v3/schemas");
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
