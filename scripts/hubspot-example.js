import 'dotenv/config';
import { Client } from '@hubspot/api-client';

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

// Example: Get contacts
async function getContacts(limit = 10) {
  const response = await hubspotClient.crm.contacts.basicApi.getPage(limit);
  return response.results;
}

// Example: Get a single contact by ID
async function getContact(contactId) {
  return await hubspotClient.crm.contacts.basicApi.getById(contactId);
}

// Example: Create a contact
async function createContact(properties) {
  return await hubspotClient.crm.contacts.basicApi.create({ properties });
}

// Example: Update a contact
async function updateContact(contactId, properties) {
  return await hubspotClient.crm.contacts.basicApi.update(contactId, { properties });
}

// Example: Search contacts
async function searchContacts(filterGroups, sorts = [], limit = 10) {
  return await hubspotClient.crm.contacts.searchApi.doSearch({
    filterGroups,
    sorts,
    limit,
  });
}

// Example: Get companies
async function getCompanies(limit = 10) {
  const response = await hubspotClient.crm.companies.basicApi.getPage(limit);
  return response.results;
}

// Example: Get deals
async function getDeals(limit = 10) {
  const response = await hubspotClient.crm.deals.basicApi.getPage(limit);
  return response.results;
}

// Run examples
async function main() {
  try {
    console.log('Fetching contacts...');
    const contacts = await getContacts(5);
    console.log('Contacts:', JSON.stringify(contacts, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.body) {
      console.error('Details:', JSON.stringify(error.body, null, 2));
    }
  }
}

main();

export { getContacts, getContact, createContact, updateContact, searchContacts, getCompanies, getDeals };
