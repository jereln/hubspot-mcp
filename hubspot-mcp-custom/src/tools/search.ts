/**
 * Unified CRM search tool with fuzzy pipeline/stage name resolution.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HubSpotClient, HubSpotApiError } from "../client.js";
import { PipelineCache } from "../utils/pipeline-cache.js";

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

const filterSchema = z.object({
  propertyName: z.string().describe("The property to filter on"),
  operator: z
    .enum([
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
    ])
    .describe("Filter operator"),
  value: z
    .string()
    .optional()
    .describe("Filter value (not needed for HAS_PROPERTY / NOT_HAS_PROPERTY)"),
  highValue: z
    .string()
    .optional()
    .describe("Upper bound for BETWEEN operator"),
  values: z
    .array(z.string())
    .optional()
    .describe("Array of values for IN / NOT_IN operators"),
});

export function registerSearchTools(
  server: McpServer,
  client: HubSpotClient,
  pipelineCache: PipelineCache
): void {
  server.tool(
    "search_crm",
    `Search any CRM object type with filters, sorting, and pagination. Supports fuzzy pipeline/stage name matching for deals and tickets -- pass human-readable names like "Sales Pipeline" or "Closed Won" and they'll be resolved to internal IDs automatically.

For deals/tickets: use pipeline_name and stage_name instead of raw pipeline/dealstage filters.
For other objects: use the filters array with property names discovered via list_properties.

Filter operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN.
Date values must be Unix timestamps in milliseconds.
Search returns a max of 10,000 results total.`,
    {
      objectType: z
        .string()
        .describe(
          "CRM object type to search (contacts, companies, deals, tickets, calls, emails, meetings, notes, tasks, or a custom object ID like '2-26247562' for organizations)"
        ),
      filters: z
        .array(filterSchema)
        .optional()
        .describe(
          "Array of property filters. All filters in the array are ANDed together."
        ),
      pipeline_name: z
        .string()
        .optional()
        .describe(
          "Fuzzy pipeline name (deals/tickets only). Resolved to pipeline ID automatically."
        ),
      stage_name: z
        .string()
        .optional()
        .describe(
          "Fuzzy stage name (deals/tickets only). Resolved to stage ID automatically."
        ),
      sorts: z
        .array(
          z.object({
            propertyName: z.string(),
            direction: z.enum(["ASCENDING", "DESCENDING"]),
          })
        )
        .optional()
        .describe("Sort results by property"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Properties to include in results"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 10, max 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response"),
    },
    async ({
      objectType,
      filters,
      pipeline_name,
      stage_name,
      sorts,
      properties,
      limit,
      after,
    }) => {
      try {
        const allFilters = [...(filters ?? [])];

        // Fuzzy pipeline/stage resolution
        if (
          pipeline_name &&
          (objectType === "deals" || objectType === "tickets")
        ) {
          const resolved = await pipelineCache.resolvePipeline(
            objectType,
            pipeline_name,
            stage_name ?? undefined
          );

          if (!resolved) {
            return formatResult({
              error: "NO_PIPELINE_MATCH",
              message: `No pipeline matching "${pipeline_name}" found for ${objectType}.`,
              suggestion:
                "Use list_pipelines to see available pipelines and their exact names.",
            });
          }

          if (resolved.confidence < 0.7) {
            return formatResult({
              warning: "AMBIGUOUS_PIPELINE_MATCH",
              message: `Pipeline "${pipeline_name}" matched "${resolved.pipelineLabel}" with low confidence (${(resolved.confidence * 100).toFixed(0)}%).`,
              candidates: resolved.alternatives,
              suggestion:
                "Use list_pipelines to see exact names, or use a more specific name.",
            });
          }

          allFilters.push({
            propertyName: "pipeline",
            operator: "EQ" as const,
            value: resolved.pipelineId,
          });

          if (resolved.stageId) {
            if (resolved.stageConfidence && resolved.stageConfidence < 0.7) {
              return formatResult({
                warning: "AMBIGUOUS_STAGE_MATCH",
                message: `Stage "${stage_name}" matched "${resolved.stageLabel}" with low confidence (${(resolved.stageConfidence * 100).toFixed(0)}%).`,
                candidates: resolved.alternatives,
                suggestion:
                  "Use list_pipelines to see exact stage names for this pipeline.",
              });
            }
            const stageProperty =
              objectType === "deals" ? "dealstage" : "hs_pipeline_stage";
            allFilters.push({
              propertyName: stageProperty,
              operator: "EQ" as const,
              value: resolved.stageId,
            });
          }
        } else if (stage_name && !pipeline_name) {
          return formatResult({
            error: "MISSING_PIPELINE",
            message:
              "stage_name requires pipeline_name to be specified as well.",
            suggestion: "Add pipeline_name or use list_pipelines to find the pipeline first.",
          });
        }

        // Build search request body
        const body: Record<string, unknown> = {
          limit: limit ?? 10,
        };

        if (allFilters.length > 0) {
          body.filterGroups = [{ filters: allFilters }];
        }
        if (sorts?.length) {
          body.sorts = sorts;
        }
        if (properties?.length) {
          body.properties = properties;
        }
        if (after) {
          body.after = after;
        }

        const data = await client.post(
          `/crm/v3/objects/${objectType}/search`,
          body
        );
        return formatResult(data);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
