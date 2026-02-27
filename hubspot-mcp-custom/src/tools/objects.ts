/**
 * CRM object read tools: get_object, list_objects, get_associations, get_objects_batch
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

export function registerObjectTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "get_object",
    "Get a single CRM object by ID with its properties. Optionally include property change history and/or specific properties. Use withHistory to see how values changed over time (e.g., deal stage progression).",
    {
      objectType: z
        .string()
        .describe(
          "CRM object type (contacts, companies, deals, tickets, calls, emails, meetings, notes, tasks, etc.)"
        ),
      objectId: z.string().describe("The object's HubSpot ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific properties to return. If omitted, returns default properties."
        ),
      propertiesWithHistory: z
        .array(z.string())
        .optional()
        .describe(
          "Properties to return with full change history (timestamped values)"
        ),
      associations: z
        .array(z.string())
        .optional()
        .describe(
          "Object types to include associations for (e.g., ['contacts', 'companies'])"
        ),
    },
    async ({ objectType, objectId, properties, propertiesWithHistory, associations }) => {
      try {
        const params: Record<string, string | undefined> = {};
        if (properties?.length) {
          params.properties = properties.join(",");
        }
        if (propertiesWithHistory?.length) {
          params.propertiesWithHistory = propertiesWithHistory.join(",");
        }
        if (associations?.length) {
          params.associations = associations.join(",");
        }
        const data = await client.get(
          `/crm/v3/objects/${objectType}/${objectId}`,
          params
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "list_objects",
    "List CRM objects of a given type with pagination. Returns default properties unless specific ones are requested.",
    {
      objectType: z
        .string()
        .describe(
          "CRM object type (contacts, companies, deals, tickets, etc.)"
        ),
      limit: z
        .number()
        .optional()
        .describe("Max results per page (default 10, max 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific properties to return"),
    },
    async ({ objectType, limit, after, properties }) => {
      try {
        const params: Record<string, string | number | undefined> = {
          limit: limit ?? 10,
          after,
        };
        if (properties?.length) {
          params.properties = properties.join(",");
        }
        const data = await client.get(
          `/crm/v3/objects/${objectType}`,
          params
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_associations",
    "Get objects associated with CRM record(s). Accepts a single objectId OR an objectIds array for batch lookup (up to 1,000 IDs). Returns associated object IDs and association types. Use get_object or get_objects_batch to then fetch details of associated records.",
    {
      fromObjectType: z
        .string()
        .describe("Source object type (e.g., 'deals')"),
      objectId: z
        .string()
        .optional()
        .describe("Single source object's HubSpot ID. Provide this OR objectIds, not both."),
      objectIds: z
        .array(z.string())
        .max(1000)
        .optional()
        .describe("Array of source object HubSpot IDs for batch lookup (max 1,000). Provide this OR objectId, not both."),
      toObjectType: z
        .string()
        .describe("Target object type (e.g., 'contacts')"),
    },
    async ({ fromObjectType, objectId, objectIds, toObjectType }) => {
      try {
        if (!objectId && !objectIds?.length) {
          return formatResult({
            error: "VALIDATION_ERROR",
            message: "Provide either objectId (single) or objectIds (batch), not neither.",
          });
        }
        if (objectId && objectIds?.length) {
          return formatResult({
            error: "VALIDATION_ERROR",
            message: "Provide either objectId (single) or objectIds (batch), not both.",
          });
        }

        if (objectIds?.length) {
          // Batch path: POST /crm/v4/associations/{from}/{to}/batch/read
          const data = await client.post(
            `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
            { inputs: objectIds.map((id: string) => ({ id })) }
          );
          return formatResult(data);
        }

        // Single path (existing behavior)
        const data = await client.get(
          `/crm/v4/objects/${fromObjectType}/${objectId}/associations/${toObjectType}`
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_objects_batch",
    "Get multiple CRM objects by ID in a single call. Returns properties for up to 100 objects. Does not return associations — use get_associations with objectIds for that.",
    {
      objectType: z
        .string()
        .describe(
          "CRM object type (contacts, companies, deals, tickets, or a custom object ID like '2-26247562')"
        ),
      objectIds: z
        .array(z.string())
        .max(100)
        .describe("Array of HubSpot object IDs to fetch (max 100)"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific properties to return. If omitted, returns default properties."
        ),
      propertiesWithHistory: z
        .array(z.string())
        .optional()
        .describe(
          "Properties to return with full change history (timestamped values)"
        ),
    },
    async ({ objectType, objectIds, properties, propertiesWithHistory }) => {
      try {
        const body: Record<string, unknown> = {
          inputs: objectIds.map((id: string) => ({ id })),
        };
        if (properties?.length) body.properties = properties;
        if (propertiesWithHistory?.length)
          body.propertiesWithHistory = propertiesWithHistory;

        const data = await client.post(
          `/crm/v3/objects/${objectType}/batch/read`,
          body
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
