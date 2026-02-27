/**
 * Marketing tools: list_email_campaigns, get_email_campaign, list_marketing_events
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

export function registerMarketingTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "list_email_campaigns",
    "List email marketing campaigns with optional filters. Returns campaign IDs, names, and summary statistics.",
    {
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 20)"),
      offset: z
        .number()
        .optional()
        .describe("Offset for pagination"),
    },
    async ({ limit, offset }) => {
      try {
        const data = await client.get("/email/public/v1/campaigns", {
          limit: limit ?? 20,
          offset,
        });
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_email_campaign",
    "Get details for a specific email campaign including content, statistics, and optionally email events (sends, opens, clicks, bounces, etc.).",
    {
      campaignId: z.string().describe("The email campaign ID"),
      includeEvents: z
        .boolean()
        .optional()
        .describe(
          "Also fetch email events (sends, opens, clicks) for this campaign (default false)"
        ),
      eventTypes: z
        .array(
          z.enum([
            "SENT",
            "DELIVERED",
            "OPEN",
            "CLICK",
            "BOUNCE",
            "UNSUBSCRIBED",
            "SPAMREPORT",
            "DROPPED",
            "DEFERRED",
          ])
        )
        .optional()
        .describe(
          "Filter events by type(s). Only used when includeEvents is true."
        ),
      eventLimit: z
        .number()
        .optional()
        .describe("Max events to return (default 50)"),
    },
    async ({ campaignId, includeEvents, eventTypes, eventLimit }) => {
      try {
        const campaign = await client.get(
          `/email/public/v1/campaigns/${campaignId}`
        );

        if (!includeEvents) {
          return formatResult(campaign);
        }

        // Fetch events for this campaign
        const eventsParams: Record<string, string | number | undefined> = {
          campaignId,
          limit: eventLimit ?? 50,
        };
        if (eventTypes?.length) {
          // The API accepts multiple eventType params, but we'll use the first one
          // since the endpoint only supports one at a time
          eventsParams.eventType = eventTypes[0];
        }

        const events = await client.get(
          "/email/public/v1/events",
          eventsParams
        );

        return formatResult({ campaign, events });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "list_marketing_events",
    "List marketing events (webinars, conferences, etc.) with optional search query. Returns event names, dates, and attendance information.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query to filter events by name"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 20)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({ query, limit, after }) => {
      try {
        const data = await client.get<{ results?: Array<Record<string, unknown>>; paging?: unknown }>(
          "/marketing/v3/marketing-events",
          { limit: limit ?? 20, after }
        );
        if (query && data.results) {
          const q = query.toLowerCase();
          data.results = data.results.filter((e) => {
            const props = e.properties as Record<string, string> | undefined;
            const name = props?.hs_event_name
              ?? (e.eventName as string)
              ?? "";
            return name.toLowerCase().includes(q);
          });
        }
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
