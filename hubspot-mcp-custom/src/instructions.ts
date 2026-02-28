/**
 * LLM instructions for the HubSpot MCP server.
 * Provides workflow guidance, CRM concepts, and search examples.
 */

export const SERVER_INSTRUCTIONS = `
# HubSpot CRM MCP Server

This is a **read-only** MCP server for querying HubSpot CRM data. It provides discovery, search, timeline, marketing, analytics, sequences, and lists tools.

## Recommended Workflow

1. **Discover structure first**: Use \`list_pipelines\`, \`list_properties\`, or \`list_owners\` to learn what fields and values exist before searching.
2. **Search with context**: Use \`search_crm\` with the discovered property names and values.
3. **Get details**: Use \`get_object\` to fetch full details, property history, or associations for a specific record.

## CRM Concepts

### Object Types
Standard object types: \`contacts\`, \`companies\`, \`deals\`, \`tickets\`, \`products\`, \`line_items\`, \`quotes\`.
Engagement types (also searchable as objects): \`calls\`, \`emails\`, \`meetings\`, \`notes\`, \`tasks\`.
Custom objects: Use \`list_custom_object_schemas\` to discover custom objects.
- **organizations** (objectTypeId: \`2-26247562\`): Central account object associated with deals, contacts, companies, and trials. Use objectTypeId \`2-26247562\` when searching or fetching.

### Properties
- System properties are prefixed with \`hs_\` (e.g., \`hs_object_id\`, \`hs_createdate\`)
- Deals use \`pipeline\` (pipeline ID) and \`dealstage\` (stage ID) -- these are internal IDs, not names
- Use \`list_properties\` to discover available properties for any object type

### Pipelines & Stages
Deals and tickets have pipelines. Each pipeline has ordered stages.
- **Always use \`list_pipelines\` first** to see available pipelines and their stage names/IDs
- The \`search_crm\` tool supports **fuzzy pipeline/stage name matching** -- you can pass human-readable names like "Sales Pipeline" or "Closed Won" and they'll be resolved to internal IDs automatically

### Associations
Objects are linked via associations (e.g., a deal is associated with contacts and a company).
Use \`get_associations\` to find linked records, then \`get_object\` to fetch their details.
**Batch associations**: When you have multiple object IDs (e.g., from a search result), use \`get_associations\` with \`objectIds\` array instead of calling it once per record. This uses HubSpot's batch API (up to 1,000 IDs per call).
**Batch object reads**: Use \`get_objects_batch\` to fetch up to 100 objects by ID in a single call.

## Search Patterns

### search_crm Examples

**Deals in a pipeline stage:**
\`\`\`
objectType: "deals"
pipeline_name: "Sales Pipeline"
stage_name: "Closed Won"
\`\`\`

**Contacts by email domain:**
\`\`\`
objectType: "contacts"
filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: "acme.com" }]
\`\`\`

**Deals created in the last 30 days:**
\`\`\`
objectType: "deals"
filters: [{ propertyName: "createdate", operator: "GTE", value: "1706745600000" }]
\`\`\`
(Note: date values are Unix timestamps in milliseconds)

**Deals by owner:**
\`\`\`
objectType: "deals"
filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: "12345" }]
\`\`\`
(Use \`list_owners\` to find owner IDs)

**Organizations by name:**
\`\`\`
objectType: "2-26247562"
filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: "acme" }]
\`\`\`

### Filter Operators
\`EQ\`, \`NEQ\`, \`LT\`, \`LTE\`, \`GT\`, \`GTE\`, \`BETWEEN\`, \`IN\`, \`NOT_IN\`,
\`HAS_PROPERTY\`, \`NOT_HAS_PROPERTY\`, \`CONTAINS_TOKEN\`, \`NOT_CONTAINS_TOKEN\`

### Lists & Memberships
HubSpot lists (static or dynamic) group contacts by criteria. Lists are often used alongside marketing events.
- Use \`search_lists\` with a query to find lists by name (e.g., "Registered for webinar")
- Use \`get_list_memberships\` to get the contact IDs in a list, then \`get_objects_batch\` to fetch their details
- **Marketing events + lists workflow**: The marketing events API returns aggregate participation counts, NOT individual contact associations. To get registrant contact IDs, find the associated HubSpot list via \`search_lists\`, then use \`get_list_memberships\`.

## Workflows (Automations)

HubSpot workflows are automations that run actions on enrolled records. Two tools are available:

- **\`list_workflows\`**: List all workflows, or fuzzy-search by name (e.g. "onboarding", "lead nurture"). Returns flow IDs, names, enabled status.
- **\`get_workflow\`**: Get full workflow details by flow ID. Returns an ASCII visualization showing the action graph (steps, branches, delays) plus complete structured JSON with all action definitions.

**Workflow patterns:**
\`\`\`
list_workflows query: "onboarding"     → find workflows by name
get_workflow flowId: "12345"           → see full logic as ASCII diagram + JSON
list_workflows enabled_only: true      → only active workflows
\`\`\`

## Gotchas
- **Search is eventually consistent**: Newly created/updated records may take a few seconds to appear in search results.
- **Search limit**: The search API returns a maximum of 10,000 results total.
- **Engagement types are objects**: Calls, emails, meetings, notes, and tasks can be searched via \`search_crm\` just like contacts or deals.
- **Property history**: Use \`get_object\` with \`withHistory: true\` to see how property values changed over time (e.g., deal stage progression).
- **Analytics breakdowns**: The analytics API supports breakdowns by \`sources\`, \`geolocation\`, \`utm-campaigns\`, \`utm-contents\`, \`utm-mediums\`, \`utm-sources\`, \`utm-terms\`, \`totals\`.
- **Sequences require userId**: The \`list_sequences\` tool requires a HubSpot userId. If omitted, it auto-resolves from the first CRM owner. Use \`list_owners\` to see available owner userIds.
- **Marketing events are aggregate-only**: \`list_marketing_events\` returns event metadata and attendance counts, but does NOT provide individual contact/registrant associations. Use the lists workflow above to get individual registrants.
- **Workflows API is v4 beta**: The workflow tools use HubSpot's v4 Automation API. Requires the \`automation\` scope on your Private App. Workflow data is read-only.
`.trim();
