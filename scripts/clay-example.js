import 'dotenv/config';

const CLAY_API_BASE = 'https://api.clay.com/v3';

// Helper for Clay API requests
async function clayRequest(endpoint, options = {}) {
  const url = `${CLAY_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.CLAY_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Clay API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Example: Get tables
async function getTables() {
  return await clayRequest('/tables');
}

// Example: Get rows from a table
async function getTableRows(tableId, limit = 100, offset = 0) {
  return await clayRequest(`/tables/${tableId}/rows?limit=${limit}&offset=${offset}`);
}

// Example: Add rows to a table
async function addRows(tableId, rows) {
  return await clayRequest(`/tables/${tableId}/rows`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

// Example: Trigger a table run
async function triggerTableRun(tableId) {
  return await clayRequest(`/tables/${tableId}/run`, {
    method: 'POST',
  });
}

// Example: Using Clay's HTTP API integration (webhook-based)
// This is for triggering Clay tables via webhook
async function triggerClayWebhook(webhookUrl, data) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Clay webhook error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Run examples
async function main() {
  try {
    console.log('Fetching Clay tables...');
    const tables = await getTables();
    console.log('Tables:', JSON.stringify(tables, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();

export { getTables, getTableRows, addRows, triggerTableRun, triggerClayWebhook };
