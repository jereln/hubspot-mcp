# CLAUDE.md

## Project Overview

Read-only, LLM-optimized MCP server for HubSpot CRM. Modular architecture with ~18 focused tools (down from 128 in the original fork). Features fuzzy pipeline/stage name resolution, structured errors, and rich LLM instructions.

## Build & Run

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run the compiled server (stdio transport)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | HubSpot Private App access token |

## Architecture

```
src/
  index.ts                  Entry point (stdio transport)
  server.ts                 McpServer creation, tool registration
  client.ts                 HubSpot REST API wrapper with structured errors
  instructions.ts           LLM guidance: workflows, CRM concepts, search examples
  tools/
    discovery.ts            list_pipelines, list_properties, list_owners, list_custom_object_schemas
    search.ts               search_crm (unified, with fuzzy pipeline/stage resolution)
    objects.ts              get_object, list_objects, get_associations
    timeline.ts             get_contact_activity, search_engagements
    analytics.ts            get_analytics (web traffic)
    marketing.ts            list_email_campaigns, get_email_campaign, list_marketing_events
    sequences.ts            list_sequences, get_sequence_enrollments
  utils/
    fuzzy.ts                Levenshtein distance, fuzzy string matching
    pipeline-cache.ts       Pipeline/stage cache with fuzzy name-to-ID resolution
```

## Key Features

- **Fuzzy pipeline/stage matching**: `search_crm` accepts human-readable names like "Sales Pipeline" or "Closed Won" and resolves them to HubSpot internal IDs
- **Structured errors**: Responses include status, category, message, and actionable suggestions
- **LLM instructions**: Rich system prompt teaching the recommended workflow (discover → search → get details)
- **Read-only**: All tools are read-only; no create/update/delete operations

## Adding New Tools

1. Create or edit a file in `src/tools/`
2. Export a `registerXTools(server, client, ...)` function
3. Wire it up in `src/server.ts`
4. Run `pnpm build` to compile

## Claude Code MCP Configuration

In `.mcp.json` at the project root:
```json
{
  "mcpServers": {
    "hubspot-custom": {
      "command": "node",
      "args": ["/path/to/hubspot-mcp-custom/dist/index.js"],
      "env": {
        "HUBSPOT_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```
