/**
 * Analyze webinar registrants: new acquisitions vs existing contacts
 */

import "dotenv/config";

const token = process.env.HUBSPOT_ACCESS_TOKEN;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function searchLists(query) {
  const res = await fetch("https://api.hubapi.com/crm/v3/lists/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, count: 20 }),
  });
  const data = await res.json();
  return data.lists || [];
}

async function getListMembers(listId, limit = 250) {
  const allIds = [];
  let after = undefined;
  while (true) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set("after", after);
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/lists/${listId}/memberships?${params}`,
      { headers }
    );
    const data = await res.json();
    const ids = (data.results || []).map((r) => r.recordId || r);
    allIds.push(...ids);
    if (data.paging?.next?.after) {
      after = data.paging.next.after;
    } else {
      break;
    }
  }
  return allIds;
}

async function getContactsBatch(ids, properties) {
  const results = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id: String(id) })),
        properties,
      }),
    });
    const data = await res.json();
    results.push(...(data.results || []));
  }
  return results;
}

async function main() {
  // Step 1: Find lists related to the webinar
  console.log("Searching for webinar-related lists...\n");
  const queries = ["Real-Time", "webinar", "Dives", "MotherDuck", "Ad Hoc"];
  const seen = new Set();
  const allLists = [];
  for (const q of queries) {
    const lists = await searchLists(q);
    for (const l of lists) {
      if (!seen.has(l.listId)) {
        seen.add(l.listId);
        allLists.push(l);
        console.log(`  ${l.listId}: ${l.name} (${l.processingType}, size: ${l.size})`);
      }
    }
  }

  if (allLists.length === 0) {
    console.log("\nNo lists found. Trying marketing events...");
    const evRes = await fetch("https://api.hubapi.com/marketing/v3/marketing-events?limit=50", { headers });
    const evData = await evRes.json();
    for (const e of evData.results || []) {
      console.log(`  Event: ${e.eventName || e.id} (id: ${e.id})`);
    }
    return;
  }

  // Step 2: Pick the best matching list (look for "Dives" or "webinar" related)
  const targetList =
    allLists.find((l) => /dives|ad.hoc|real.time/i.test(l.name)) || allLists[0];
  console.log(`\nUsing list: "${targetList.name}" (ID: ${targetList.listId}, size: ${targetList.size})\n`);

  // Step 3: Get all member contact IDs
  console.log("Fetching list members...");
  const memberIds = await getListMembers(targetList.listId);
  console.log(`  Found ${memberIds.length} members\n`);

  // Step 4: Batch fetch contacts with createdate and key properties
  console.log("Fetching contact details...");
  const contacts = await getContactsBatch(memberIds, [
    "createdate",
    "firstname",
    "lastname",
    "email",
    "company",
    "hs_analytics_source",
    "hs_analytics_first_url",
    "lifecyclestage",
  ]);
  console.log(`  Fetched ${contacts.length} contacts\n`);

  // Step 5: Analyze — compare createdate to event window
  // Use a 7-day window around the event as "new acquisition"
  // First, find the cluster of create dates to detect the event date
  const createDates = contacts
    .map((c) => new Date(c.properties.createdate))
    .sort((a, b) => a - b);

  // The event likely happened recently — find the most common create date cluster
  const dateCounts = {};
  for (const d of createDates) {
    const key = d.toISOString().split("T")[0];
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  }

  const sortedDates = Object.entries(dateCounts).sort((a, b) => b[1] - a[1]);
  console.log("Top contact creation dates:");
  for (const [date, count] of sortedDates.slice(0, 10)) {
    console.log(`  ${date}: ${count} contacts`);
  }

  // Use a heuristic: if a contact was created within 3 days of registering
  // for the event, they're likely a new acquisition. We'll use the most
  // common recent creation date cluster as the event window.
  // But actually, the best signal is: was the contact created BEFORE the
  // event promo started, or during/after?

  // Let's use 30 days before today as the cutoff for "new from this program"
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const newContacts = [];
  const existingContacts = [];
  for (const c of contacts) {
    const created = new Date(c.properties.createdate);
    if (created >= thirtyDaysAgo) {
      newContacts.push(c);
    } else {
      existingContacts.push(c);
    }
  }

  console.log(`\n=== ACQUISITION ANALYSIS ===`);
  console.log(`Total registrants: ${contacts.length}`);
  console.log(`New contacts (created in last 30 days): ${newContacts.length} (${((newContacts.length / contacts.length) * 100).toFixed(1)}%)`);
  console.log(`Existing contacts (created >30 days ago): ${existingContacts.length} (${((existingContacts.length / contacts.length) * 100).toFixed(1)}%)`);

  // Source breakdown for new contacts
  const newSources = {};
  for (const c of newContacts) {
    const src = c.properties.hs_analytics_source || "UNKNOWN";
    newSources[src] = (newSources[src] || 0) + 1;
  }
  console.log(`\nNew contact sources:`);
  for (const [src, count] of Object.entries(newSources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  // Source breakdown for existing contacts
  const existingSources = {};
  for (const c of existingContacts) {
    const src = c.properties.hs_analytics_source || "UNKNOWN";
    existingSources[src] = (existingSources[src] || 0) + 1;
  }
  console.log(`\nExisting contact sources:`);
  for (const [src, count] of Object.entries(existingSources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  // Lifecycle stage breakdown
  console.log(`\nLifecycle stages (new contacts):`);
  const newStages = {};
  for (const c of newContacts) {
    const stage = c.properties.lifecyclestage || "unknown";
    newStages[stage] = (newStages[stage] || 0) + 1;
  }
  for (const [stage, count] of Object.entries(newStages).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage}: ${count}`);
  }

  console.log(`\nLifecycle stages (existing contacts):`);
  const existingStages = {};
  for (const c of existingContacts) {
    const stage = c.properties.lifecyclestage || "unknown";
    existingStages[stage] = (existingStages[stage] || 0) + 1;
  }
  for (const [stage, count] of Object.entries(existingStages).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage}: ${count}`);
  }

  // Sample of new contacts
  console.log(`\nSample new contacts:`);
  for (const c of newContacts.slice(0, 10)) {
    const p = c.properties;
    console.log(`  ${p.firstname || ""} ${p.lastname || ""} <${p.email || "no email"}> — ${p.company || "no company"} — created ${p.createdate?.split("T")[0]} — source: ${p.hs_analytics_source || "?"}`);
  }
}

main().catch(console.error);
