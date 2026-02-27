/**
 * Analytics tool: get_analytics (web traffic)
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

export function registerAnalyticsTools(server: McpServer, client: HubSpotClient): void {
  server.tool(
    "get_analytics",
    `Get web analytics data from HubSpot, broken down by a dimension and time period.

Breakdown dimensions: sources, geolocation, utm-campaigns, utm-contents, utm-mediums, utm-sources, utm-terms, totals.
Time periods: daily, weekly, monthly, summarize/daily, summarize/weekly, summarize/monthly.

Use "summarize/" prefix to get aggregated totals instead of time-series data.
Requires Marketing Hub Professional or Enterprise.`,
    {
      breakdownBy: z
        .enum([
          "sources",
          "geolocation",
          "utm-campaigns",
          "utm-contents",
          "utm-mediums",
          "utm-sources",
          "utm-terms",
          "totals",
        ])
        .describe("Dimension to break down analytics by"),
      timePeriod: z
        .enum([
          "daily",
          "weekly",
          "monthly",
          "summarize/daily",
          "summarize/weekly",
          "summarize/monthly",
        ])
        .describe(
          "Time granularity. Use 'summarize/' prefix for aggregated totals."
        ),
      start: z
        .string()
        .optional()
        .describe("Start date in YYYYMMDD format (e.g., '20240101')"),
      end: z
        .string()
        .optional()
        .describe("End date in YYYYMMDD format (e.g., '20240131')"),
    },
    async ({ breakdownBy, timePeriod, start, end }) => {
      try {
        const data = await client.get(
          `/analytics/v2/reports/${breakdownBy}/${timePeriod}`,
          { start, end }
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
