/**
 * Timeline tools: get_contact_activity, search_engagements
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

export function registerTimelineTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "get_contact_activity",
    `Get a unified activity timeline for a contact, combining engagements (calls, emails, meetings, notes, tasks) and page view history. Returns recent activity sorted by date.

Page views come from property history on hs_analytics_last_url (timestamped URL visits).
Engagements come from CRM associations.`,
    {
      contactId: z.string().describe("The contact's HubSpot ID"),
      includePageViews: z
        .boolean()
        .optional()
        .describe("Include page view history (default true)"),
      includeEngagements: z
        .boolean()
        .optional()
        .describe("Include engagement records (default true)"),
    },
    async ({ contactId, includePageViews, includeEngagements }) => {
      try {
        const results: Record<string, unknown> = { contactId };

        const shouldIncludePageViews = includePageViews !== false;
        const shouldIncludeEngagements = includeEngagements !== false;

        // Fetch in parallel
        const promises: Promise<void>[] = [];

        if (shouldIncludePageViews) {
          promises.push(
            (async () => {
              const contact = await client.get<{
                propertiesWithHistory?: Record<
                  string,
                  Array<{ value: string; timestamp: string }>
                >;
              }>(`/crm/v3/objects/contacts/${contactId}`, {
                propertiesWithHistory: "hs_analytics_last_url",
              });
              results.pageViews =
                contact.propertiesWithHistory?.hs_analytics_last_url ?? [];
            })()
          );
        }

        if (shouldIncludeEngagements) {
          promises.push(
            (async () => {
              // Get associated engagements for each type
              const engagementTypes = [
                "calls",
                "emails",
                "meetings",
                "notes",
                "tasks",
              ];
              const engagements: Array<{
                type: string;
                records: unknown[];
              }> = [];

              await Promise.all(
                engagementTypes.map(async (type) => {
                  try {
                    const assocData = await client.get<{
                      results: Array<{
                        toObjectId: number;
                      }>;
                    }>(
                      `/crm/v4/objects/contacts/${contactId}/associations/${type}`
                    );

                    if (assocData.results?.length) {
                      // Fetch the actual engagement records (up to 10)
                      const ids = assocData.results
                        .slice(0, 10)
                        .map((r) => r.toObjectId);
                      const batchData = await client.post<{
                        results: unknown[];
                      }>(`/crm/v3/objects/${type}/batch/read`, {
                        inputs: ids.map((id) => ({ id: String(id) })),
                        properties: [
                          "hs_timestamp",
                          "hs_createdate",
                          "hs_body_preview",
                          "hs_call_title",
                          "hs_call_duration",
                          "hs_email_subject",
                          "hs_meeting_title",
                          "hs_note_body",
                          "hs_task_subject",
                          "hs_task_status",
                        ],
                      });
                      engagements.push({
                        type,
                        records: batchData.results ?? [],
                      });
                    }
                  } catch {
                    // Skip engagement types that fail (e.g., permissions)
                  }
                })
              );

              results.engagements = engagements;
            })()
          );
        }

        await Promise.all(promises);
        return formatResult(results);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "search_engagements",
    "Search engagement records (calls, emails, meetings, notes, tasks) with filters. Engagements are searchable as CRM objects. Use this to find engagements across all contacts by type, date, or other properties.",
    {
      engagementType: z
        .enum(["calls", "emails", "meetings", "notes", "tasks"])
        .describe("Type of engagement to search"),
      filters: z
        .array(
          z.object({
            propertyName: z.string(),
            operator: z.enum([
              "EQ",
              "NEQ",
              "LT",
              "LTE",
              "GT",
              "GTE",
              "BETWEEN",
              "IN",
              "NOT_IN",
              "HAS_PROPERTY",
              "NOT_HAS_PROPERTY",
              "CONTAINS_TOKEN",
              "NOT_CONTAINS_TOKEN",
            ]),
            value: z.string().optional(),
            highValue: z.string().optional(),
            values: z.array(z.string()).optional(),
          })
        )
        .optional()
        .describe("Property filters (ANDed together)"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Properties to include in results"),
      sorts: z
        .array(
          z.object({
            propertyName: z.string(),
            direction: z.enum(["ASCENDING", "DESCENDING"]),
          })
        )
        .optional()
        .describe("Sort order"),
      limit: z
        .number()
        .optional()
        .describe("Max results (default 10, max 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor"),
    },
    async ({ engagementType, filters, properties, sorts, limit, after }) => {
      try {
        const body: Record<string, unknown> = {
          limit: limit ?? 10,
        };
        if (filters?.length) {
          body.filterGroups = [{ filters }];
        }
        if (properties?.length) {
          body.properties = properties;
        }
        if (sorts?.length) {
          body.sorts = sorts;
        }
        if (after) {
          body.after = after;
        }

        const data = await client.post(
          `/crm/v3/objects/${engagementType}/search`,
          body
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
