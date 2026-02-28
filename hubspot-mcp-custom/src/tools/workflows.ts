/**
 * Workflow tools: list_workflows, get_workflow
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HubSpotClient, HubSpotApiError } from "../client.js";
import { WorkflowCache } from "../utils/workflow-cache.js";
import { renderWorkflow } from "../utils/workflow-renderer.js";
import type { WorkflowFlow } from "../utils/workflow-renderer.js";

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

export function registerWorkflowTools(
  server: McpServer,
  client: HubSpotClient,
  workflowCache: WorkflowCache
): void {
  server.tool(
    "list_workflows",
    "List HubSpot workflows (automations). Without a query, returns all workflows. With a query, fuzzy-matches against workflow names. Returns workflow names, flow IDs, enabled status, and object types.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Fuzzy search query to match workflow names (e.g. 'onboarding', 'lead nurture')"
        ),
      enabled_only: z
        .boolean()
        .optional()
        .describe("If true, only return enabled workflows"),
    },
    async ({ query, enabled_only }) => {
      try {
        let workflows = query
          ? await workflowCache.searchByName(query)
          : await workflowCache.getAll();

        if (enabled_only) {
          workflows = workflows.filter((w) => w.isEnabled);
        }

        const results = workflows.map((w) => ({
          flowId: w.id,
          name: w.name,
          isEnabled: w.isEnabled,
          objectTypeId: w.objectTypeId,
          triggerType: w.triggerType,
          actionCount: w.actions.length,
        }));

        return formatResult({
          total: results.length,
          workflows: results,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.tool(
    "get_workflow",
    "Get full details of a HubSpot workflow by flow ID. Returns an ASCII visualization of the workflow logic (actions, branches, delays) plus the complete structured JSON. Use list_workflows first to find flow IDs.",
    {
      flowId: z
        .string()
        .describe("The workflow flow ID (from list_workflows)"),
    },
    async ({ flowId }) => {
      try {
        const workflow = await workflowCache.getById(flowId);
        if (!workflow) {
          return formatResult({
            error: "WORKFLOW_NOT_FOUND",
            message: `No workflow found with flowId "${flowId}"`,
            suggestion: "Use list_workflows to find valid flow IDs.",
          });
        }

        const flow: WorkflowFlow = {
          id: workflow.id,
          name: workflow.name,
          isEnabled: workflow.isEnabled,
          objectTypeId: workflow.objectTypeId,
          triggerType: workflow.triggerType,
          startActionId: workflow.startActionId,
          actions: workflow.actions,
          enrollmentCriteria: workflow.enrollmentCriteria,
        };

        const ascii = renderWorkflow(flow);

        return {
          content: [
            {
              type: "text" as const,
              text: ascii,
            },
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  flowId: workflow.id,
                  name: workflow.name,
                  isEnabled: workflow.isEnabled,
                  objectTypeId: workflow.objectTypeId,
                  triggerType: workflow.triggerType,
                  startActionId: workflow.startActionId,
                  actionCount: workflow.actions.length,
                  actions: workflow.actions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
