# HubSpot MCP Server

Read-only, LLM-optimized [Model Context Protocol](https://modelcontextprotocol.io/introduction) server for [HubSpot](https://hubspot.com/) CRM. 22 focused tools (down from 128 in the original fork), modular architecture, fuzzy pipeline/stage name resolution, workflow visualization, and rich LLM instructions.

## Prerequisites

A HubSpot Private App access token is required. Create one at **Settings > Integrations > Private Apps** in HubSpot. See the [HubSpot API guide](https://developers.hubspot.com/docs/guides/api/overview) for details.

## Setup

```bash
pnpm install
pnpm build
```

## MCP Client Configuration

Add to your MCP client config (e.g. `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "hubspot": {
      "command": "node",
      "args": ["/path/to/hubspot-mcp-custom/dist/index.js"],
      "env": {
        "HUBSPOT_ACCESS_TOKEN": "your-access-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | HubSpot Private App access token |

## Tools

### Discovery

| Tool | Description |
|------|-------------|
| `list_pipelines` | List pipelines and stages for deals or tickets |
| `list_properties` | List available properties for any object type |
| `list_owners` | List HubSpot users/owners |
| `list_custom_object_schemas` | Discover custom object definitions |

### Search

| Tool | Description |
|------|-------------|
| `search_crm` | Search any CRM object type with filters, sorting, and pagination. Supports fuzzy pipeline/stage name matching for deals and tickets. Works with standard objects and custom objects (e.g. `2-26247562` for organizations). |

### Objects

| Tool | Description |
|------|-------------|
| `get_object` | Get a single CRM object by ID with properties, history, and associations |
| `get_objects_batch` | Get up to 100 CRM objects by ID in a single call |
| `list_objects` | List CRM objects of a given type with pagination |
| `get_associations` | Get associated objects for a single record or batch of up to 1,000 records |

### Timeline & Engagements

| Tool | Description |
|------|-------------|
| `get_contact_activity` | Get a contact's activity timeline (page views, form submissions, etc.) |
| `search_engagements` | Search calls, emails, meetings, notes, or tasks |

### Marketing

| Tool | Description |
|------|-------------|
| `list_email_campaigns` | List marketing email campaigns |
| `get_email_campaign` | Get details for a specific email campaign |
| `list_marketing_events` | List marketing events |

### Analytics

| Tool | Description |
|------|-------------|
| `get_analytics` | Get web traffic analytics with breakdowns by source, geo, UTM, etc. |

### Lists

| Tool | Description |
|------|-------------|
| `search_lists` | Search HubSpot lists by name. Returns list names, IDs, types, and sizes. |
| `get_list_memberships` | Get contact IDs that are members of a list. Supports pagination. |

### Sequences

| Tool | Description |
|------|-------------|
| `list_sequences` | List sales sequences (auto-resolves userId from CRM owners if omitted) |
| `get_sequence_enrollments` | Get enrollment data for a sequence |

### Workflows

| Tool | Description |
|------|-------------|
| `list_workflows` | List workflows with optional fuzzy name search (e.g. "onboarding") and enabled-only filter |
| `get_workflow` | Get full workflow details by flow ID — returns an ASCII visualization of the action graph plus complete structured JSON |

## Key Features

- **Read-only**: No create, update, or delete operations
- **Workflow visualization**: `get_workflow` renders the full action graph as an ASCII box-and-arrow diagram — branches, delays, conditions, and convergence points
- **Fuzzy matching**: Pass human-readable names like "Sales Pipeline" or "Closed Won" to `search_crm`, or search workflow names with `list_workflows` — fuzzy-matched automatically
- **Batch operations**: `get_associations` accepts an array of up to 1,000 IDs; `get_objects_batch` fetches up to 100 objects in one call
- **Custom object support**: Search and fetch custom objects like organizations (`2-26247562`) alongside standard CRM objects
- **Structured errors**: Responses include status, category, message, and actionable suggestions
- **LLM instructions**: Built-in system prompt teaching the recommended workflow (discover → search → get details)
- **Rate-limit handling**: Automatic retry on 429 responses

## Architecture

```
src/
  index.ts                  Entry point (stdio transport)
  server.ts                 McpServer creation, tool registration
  client.ts                 HubSpot REST client with structured errors
  instructions.ts           LLM guidance: workflows, CRM concepts, search examples
  tools/
    discovery.ts            list_pipelines, list_properties, list_owners, list_custom_object_schemas
    search.ts               search_crm (unified, with fuzzy pipeline/stage resolution)
    objects.ts              get_object, get_objects_batch, list_objects, get_associations
    timeline.ts             get_contact_activity, search_engagements
    analytics.ts            get_analytics
    marketing.ts            list_email_campaigns, get_email_campaign, list_marketing_events
    lists.ts                search_lists, get_list_memberships
    sequences.ts            list_sequences, get_sequence_enrollments
    workflows.ts            list_workflows, get_workflow
  utils/
    fuzzy.ts                Levenshtein distance, fuzzy string matching
    pipeline-cache.ts       Pipeline/stage cache with fuzzy name-to-ID resolution
    workflow-cache.ts       Workflow cache with fuzzy name search
    workflow-renderer.ts    ASCII box-and-arrow visualization engine
```

## License

MIT
