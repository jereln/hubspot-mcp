# HubSpot MCP Server

Read-only [Model Context Protocol](https://modelcontextprotocol.io/introduction) server for [HubSpot](https://hubspot.com/) CRM. 20 focused tools, fuzzy pipeline/stage name resolution, and built-in LLM instructions.

## Quick Start

### 1. Clone and build

```bash
git clone https://github.com/jereln/hubspot-mcp.git
cd hubspot-mcp/hubspot-mcp-custom
pnpm install
pnpm build
```

### 2. Create a HubSpot Private App

Go to **Settings > Integrations > Private Apps** in HubSpot and create a new app with these scopes:

| Scope | Used by |
|-------|---------|
| `crm.objects.contacts.read` | Contacts, associations, timeline |
| `crm.objects.companies.read` | Companies, associations |
| `crm.objects.deals.read` | Deals, associations |
| `crm.objects.custom.read` | Custom objects (e.g. organizations) |
| `crm.schemas.custom.read` | `list_custom_object_schemas` |
| `crm.objects.owners.read` | `list_owners`, sequence userId resolution |
| `crm.lists.read` | `search_lists`, `get_list_memberships` |
| `sales-email-read` | `list_sequences`, `get_sequence_enrollments` |
| `content` | `list_email_campaigns`, `get_email_campaign` |
| `analytics.read` | `get_analytics` |

Copy the access token from the Private App page.

### 3. Configure your MCP client

Add to your `.mcp.json` (for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)):

```json
{
  "mcpServers": {
    "hubspot": {
      "command": "node",
      "args": ["/absolute/path/to/hubspot-mcp/hubspot-mcp-custom/dist/index.js"],
      "env": {
        "HUBSPOT_ACCESS_TOKEN": "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  }
}
```

Replace the path and token with your own values.

For other MCP clients (Cursor, Windsurf, etc.), use the same `command`, `args`, and `env` in whatever config format they expect.

### 4. Verify

In Claude Code, run `/mcp` to check the server is connected and all 20 tools are registered.

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
| `search_crm` | Search any CRM object type with filters, sorting, and pagination. Supports fuzzy pipeline/stage name matching. |

### Objects

| Tool | Description |
|------|-------------|
| `get_object` | Get a single CRM object by ID with properties, history, and associations |
| `get_objects_batch` | Get up to 100 CRM objects by ID in a single call |
| `list_objects` | List CRM objects of a given type with pagination |
| `get_associations` | Get associated objects for one record or a batch of up to 1,000 |

### Timeline & Engagements

| Tool | Description |
|------|-------------|
| `get_contact_activity` | Get a contact's activity timeline (page views, form submissions, etc.) |
| `search_engagements` | Search calls, emails, meetings, notes, or tasks |

### Marketing

| Tool | Description |
|------|-------------|
| `list_email_campaigns` | List marketing email campaigns |
| `get_email_campaign` | Get campaign details and optionally email events |
| `list_marketing_events` | List marketing events (webinars, conferences, etc.) |

### Lists

| Tool | Description |
|------|-------------|
| `search_lists` | Search HubSpot lists by name. Returns names, IDs, types, and sizes. |
| `get_list_memberships` | Get contact IDs in a list. Use with `get_objects_batch` to fetch details. |

### Analytics

| Tool | Description |
|------|-------------|
| `get_analytics` | Web traffic analytics with breakdowns by source, geo, UTM, etc. |

### Sequences

| Tool | Description |
|------|-------------|
| `list_sequences` | List sales sequences (auto-resolves userId if omitted) |
| `get_sequence_enrollments` | Get enrollment status for a contact |

## Key Features

- **Read-only** — no create, update, or delete operations
- **Fuzzy matching** — pass names like "Sales Pipeline" or "Closed Won" to `search_crm` instead of internal IDs
- **Batch operations** — `get_associations` handles up to 1,000 IDs; `get_objects_batch` fetches up to 100 objects per call
- **Built-in LLM instructions** — the server teaches the AI the recommended workflow (discover structure, then search, then get details)
- **Rate-limit handling** — automatic retry on 429 responses

## License

MIT
