import 'dotenv/config';
import { Client } from '@hubspot/api-client';

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

/**
 * Get page view history for a contact
 * Uses propertiesWithHistory to retrieve timestamped URL history
 */
async function getPageViewHistory(contactId, daysBack = 3) {
  const response = await hubspotClient.crm.contacts.basicApi.getById(
    contactId,
    undefined, // properties (we'll use propertiesWithHistory instead)
    ['hs_analytics_last_url'], // propertiesWithHistory
    undefined, // associations
    false // archived
  );

  const urlHistory = response.propertiesWithHistory?.hs_analytics_last_url || [];

  // Filter to entries within the specified time range
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const recentPageViews = urlHistory
    .filter(entry => new Date(entry.timestamp) >= cutoffDate)
    .map(entry => ({
      url: entry.value,
      timestamp: entry.timestamp,
      date: new Date(entry.timestamp).toLocaleString()
    }));

  return {
    contactId,
    totalHistoryEntries: urlHistory.length,
    recentPageViews,
    summary: recentPageViews.map(pv => pv.url).join(' → ')
  };
}

/**
 * Search for contacts with recent website activity and get their page view history
 */
async function getContactsWithRecentActivity(daysBack = 3, limit = 10) {
  const cutoffTimestamp = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'hs_analytics_last_visit_timestamp',
            operator: 'GTE',
            value: cutoffTimestamp.toString()
          }
        ]
      }
    ],
    properties: ['email', 'firstname', 'lastname', 'hs_analytics_last_url'],
    limit
  });

  // For each contact, get their full page view history
  const contactsWithHistory = await Promise.all(
    searchResponse.results.map(async (contact) => {
      const history = await getPageViewHistory(contact.id, daysBack);
      return {
        id: contact.id,
        email: contact.properties.email,
        name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
        ...history
      };
    })
  );

  return contactsWithHistory;
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const contactId = args[0];
  const daysBack = parseInt(args[1]) || 3;

  try {
    if (contactId) {
      // Single contact lookup
      console.log(`\nFetching page view history for contact ${contactId} (last ${daysBack} days)...\n`);
      const result = await getPageViewHistory(contactId, daysBack);
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Search for contacts with recent activity
      console.log(`\nSearching for contacts with activity in the last ${daysBack} days...\n`);
      const results = await getContactsWithRecentActivity(daysBack, 5);
      console.log(JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.body) {
      console.error('Details:', JSON.stringify(error.body, null, 2));
    }
  }
}

main();

export { getPageViewHistory, getContactsWithRecentActivity };
