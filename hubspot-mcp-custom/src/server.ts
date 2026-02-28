/**
 * MCP Server creation and tool registration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HubSpotClient } from "./client.js";
import { PipelineCache } from "./utils/pipeline-cache.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerObjectTools } from "./tools/objects.js";
import { registerSearchTools } from "./tools/search.js";
import { registerTimelineTools } from "./tools/timeline.js";
import { registerMarketingTools } from "./tools/marketing.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerSequenceTools } from "./tools/sequences.js";
import { registerListTools } from "./tools/lists.js";
import { WorkflowCache } from "./utils/workflow-cache.js";
import { registerWorkflowTools } from "./tools/workflows.js";

export function createServer(): McpServer {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN environment variable is required. " +
        "Create a Private App at Settings > Integrations > Private Apps in HubSpot."
    );
  }

  const server = new McpServer(
    {
      name: "hubspot",
      version: "3.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const client = new HubSpotClient(accessToken);
  const pipelineCache = new PipelineCache(client);
  const workflowCache = new WorkflowCache(client);

  // Register all tool groups
  registerDiscoveryTools(server, client);
  registerObjectTools(server, client);
  registerSearchTools(server, client, pipelineCache);
  registerTimelineTools(server, client);
  registerMarketingTools(server, client);
  registerAnalyticsTools(server, client);
  registerSequenceTools(server, client);
  registerListTools(server, client);
  registerWorkflowTools(server, client, workflowCache);

  return server;
}
