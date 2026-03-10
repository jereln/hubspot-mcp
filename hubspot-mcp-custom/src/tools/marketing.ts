/**
 * Marketing tools: list_email_campaigns, get_email_campaign, list_marketing_events,
 * get_event_participants, get_contact_event_history
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

  server.tool(
    "get_event_participants",
    "Get individual participants for a marketing event. Returns contact details, attendance state, and timestamps for each participant. Provide objectId (preferred, auto-resolves external IDs) OR both externalAccountId + externalEventId.",
    {
      objectId: z
        .string()
        .optional()
        .describe("HubSpot marketing event ID (from list_marketing_events). Preferred — auto-resolves external IDs."),
      externalAccountId: z
        .string()
        .optional()
        .describe('The external account ID (e.g. Zoom app ID "178192"). Not needed if objectId is provided.'),
      externalEventId: z
        .string()
        .optional()
        .describe('The external event ID (e.g. "99472196913-1738776425000"). Not needed if objectId is provided.'),
      state: z
        .enum(["REGISTERED", "ATTENDED", "CANCELLED", "NO_SHOW"])
        .optional()
        .describe("Filter by attendance state"),
      limit: z
        .number()
        .optional()
        .describe("Max participants to return (default 100). Auto-paginates."),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({ objectId, externalAccountId, externalEventId, state, limit, after }) => {
      try {
        // If objectId provided, resolve external IDs from the event
        if (objectId && (!externalAccountId || !externalEventId)) {
          const event = await client.get<Record<string, unknown>>(
            `/marketing/v3/marketing-events/${encodeURIComponent(objectId)}`
          );
          const appInfo = event.appInfo as { id?: string } | undefined;
          externalAccountId = externalAccountId
            ?? (event.externalAccountId as string | undefined)
            ?? appInfo?.id;
          externalEventId = externalEventId ?? (event.externalEventId as string | undefined);
        }

        if (!externalAccountId || !externalEventId) {
          return formatError(
            new Error("Provide objectId OR both externalAccountId and externalEventId. Could not resolve external IDs from the event.")
          );
        }

        const maxResults = limit ?? 100;
        const allResults: unknown[] = [];
        let cursor = after;

        while (allResults.length < maxResults) {
          const pageSize = Math.min(100, maxResults - allResults.length);
          const data = await client.get<{
            results?: unknown[];
            paging?: { next?: { after?: string } };
          }>(
            `/marketing/v3/marketing-events/participations/${encodeURIComponent(externalAccountId)}/${encodeURIComponent(externalEventId)}/breakdown`,
            { state, limit: pageSize, after: cursor }
          );

          if (data.results) {
            allResults.push(...data.results);
          }

          cursor = data.paging?.next?.after;
          if (!cursor || !data.results?.length) break;
        }

        return formatResult({ total: allResults.length, results: allResults });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_contact_event_history",
    "Get all marketing events a specific contact participated in. Returns event details, participation states, and timestamps.",
    {
      contactIdentifier: z
        .string()
        .describe("Contact ID or email address"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({ contactIdentifier, limit, after }) => {
      try {
        const data = await client.get(
          `/marketing/v3/marketing-events/participations/contacts/${encodeURIComponent(contactIdentifier)}/breakdown`,
          { limit: limit ?? 100, after }
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
