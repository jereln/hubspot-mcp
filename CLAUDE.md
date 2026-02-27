# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a sandbox for testing and developing HubSpot and Clay API integrations. The project uses Node.js (ES modules) with the official HubSpot API client.

## Setup

```bash
npm install
cp .env.example .env  # Then add your API keys
```

## Running Scripts

```bash
# Run HubSpot examples
npm run hubspot

# Run Clay examples
npm run clay

# Get contact page view history (last 3 days)
npm run pageviews                    # Search contacts with recent activity
npm run pageviews <contactId>        # Single contact lookup
npm run pageviews <contactId> 7      # Custom days back

# Run any script directly
node scripts/your-script.js
```

## API Configuration

- **HubSpot**: Requires `HUBSPOT_ACCESS_TOKEN` from a HubSpot Private App
- **Clay**: Requires `CLAY_API_KEY` from Clay settings

## HubSpot API Patterns

The `@hubspot/api-client` is initialized with an access token and provides typed access to all HubSpot APIs:

```javascript
import { Client } from '@hubspot/api-client';
const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

// CRM objects follow the pattern: hubspotClient.crm.<object>.<api>.<method>()
// Examples:
hubspotClient.crm.contacts.basicApi.getPage(limit)
hubspotClient.crm.contacts.basicApi.getById(id)
hubspotClient.crm.contacts.searchApi.doSearch({ filterGroups, sorts, limit })
hubspotClient.crm.companies.basicApi.create({ properties })
hubspotClient.crm.deals.basicApi.update(id, { properties })
```

### Page View History
HubSpot doesn't expose page views as discrete events. Use `propertiesWithHistory` to get timestamped URL history:

```javascript
// Node.js client
const response = await hubspotClient.crm.contacts.basicApi.getById(
  contactId,
  undefined,
  ['hs_analytics_last_url'], // propertiesWithHistory
);
// Returns: response.propertiesWithHistory.hs_analytics_last_url[]

// Raw API (for Clay HTTP action)
GET https://api.hubapi.com/crm/v3/objects/contacts/{contactId}?propertiesWithHistory=hs_analytics_last_url
Authorization: Bearer {token}
```

## Clay API Patterns

Clay uses a REST API with Bearer token authentication:

```javascript
// Base URL: https://api.clay.com/v3
// Auth header: Authorization: Bearer <CLAY_API_KEY>

// Common endpoints:
GET  /tables              - List tables
GET  /tables/:id/rows     - Get table rows
POST /tables/:id/rows     - Add rows to table
POST /tables/:id/run      - Trigger table run
```

## File Structure

- `scripts/` - Individual test scripts for API requests
- `.env` - API keys (not committed)

## Documentation References

Fetch these on-demand when working on specific tasks:

- **HubSpot API**: https://developers.hubspot.com/docs/api-reference/crm-calling-extensions-v3/guide
- **Clay Docs**: https://university.clay.com/docs
