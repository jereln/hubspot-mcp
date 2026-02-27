import 'dotenv/config';
import { Client } from '@hubspot/api-client';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

// ─── Concurrency limiter ────────────────────────────────────────────────────

function createLimiter(concurrency = 5, delayMs = 200) {
  let active = 0;
  const queue = [];

  function tryNext() {
    while (queue.length > 0 && active < concurrency) {
      const next = queue.shift();
      next();
    }
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          tryNext();
        }
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

const limiter = createLimiter(5, 200);

// ─── API helpers with retry ─────────────────────────────────────────────────

async function apiRequest(method, path, body, retries = 3) {
  return limiter(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const opts = { method, path };
      if (body) opts.body = body;
      const response = await hubspotClient.apiRequest(opts);

      if (response.status === 429) {
        const wait = parseInt(response.headers.get('retry-after') || '2', 10);
        console.log(`    Rate limited, waiting ${wait}s...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
      }
      return response.json();
    }
    throw new Error(`${method} ${path} failed after ${retries} retries (429)`);
  });
}

const apiGet = (path) => apiRequest('GET', path);
const apiPost = (path, body) => apiRequest('POST', path, body);

// ─── Paginated email search ─────────────────────────────────────────────────

async function searchAllEmails(filterGroups, properties) {
  const results = [];
  let after = undefined;
  let pages = 0;

  while (true) {
    const body = { filterGroups, properties, limit: 100 };
    if (after) body.after = after;

    const data = await apiPost('/crm/v3/objects/emails/search', body);
    results.push(...(data.results || []));
    pages++;

    if (data.paging?.next?.after) {
      after = data.paging.next.after;
      if (results.length >= 9800) {
        return { results, pages, hitLimit: true };
      }
    } else {
      break;
    }
  }
  return { results, pages, hitLimit: false };
}

// ─── Time window helpers ────────────────────────────────────────────────────

function getMonthlyWindows(startDate, endDate) {
  const windows = [];
  const current = new Date(startDate);
  while (current < endDate) {
    const windowStart = new Date(current);
    current.setMonth(current.getMonth() + 1);
    const windowEnd = current < endDate ? new Date(current) : new Date(endDate);
    windows.push({ start: windowStart, end: windowEnd });
  }
  return windows;
}

function splitWindow(window) {
  const mid = new Date((window.start.getTime() + window.end.getTime()) / 2);
  return [
    { start: window.start, end: mid },
    { start: mid, end: window.end },
  ];
}

// ─── Phase 1: Bootstrap ─────────────────────────────────────────────────────

async function fetchOwners() {
  console.log('Phase 1: Fetching owners...');
  const ownerMap = {};
  let after = undefined;

  while (true) {
    const path = after
      ? `/crm/v3/owners?limit=100&after=${after}`
      : '/crm/v3/owners?limit=100';
    const data = await apiGet(path);
    for (const owner of (data.results || [])) {
      ownerMap[owner.id] = {
        name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim(),
        email: owner.email,
        userId: owner.userId,
      };
    }
    if (data.paging?.next?.after) {
      after = data.paging.next.after;
    } else {
      break;
    }
  }

  console.log(`  Found ${Object.keys(ownerMap).length} owners`);
  return ownerMap;
}

function parseSalesTeam() {
  const csv = readFileSync(join(projectRoot, 'sales-team.csv'), 'utf-8');
  const lines = csv.trim().split('\n').slice(1);
  const roleMap = {};
  for (const line of lines) {
    const [email, name, role] = line.split(',');
    roleMap[email.trim()] = { name: name.trim(), role: role.trim() };
  }
  return roleMap;
}

// ─── Phase 2: Outbound sequence emails ──────────────────────────────────────

const OUTBOUND_PROPERTIES = [
  'hs_sequence_id', 'hs_template_id', 'hs_email_subject',
  'hs_body_preview', 'hs_email_open_count', 'hs_email_click_count',
  'hubspot_owner_id', 'hs_timestamp', 'hs_email_to_email',
  'hs_email_status', 'hs_email_post_send_status',
];

function outboundFilters(window) {
  return [{
    filters: [
      { propertyName: 'hs_email_direction', operator: 'EQ', value: 'EMAIL' },
      { propertyName: 'hs_sequence_id', operator: 'HAS_PROPERTY' },
      { propertyName: 'hs_timestamp', operator: 'GTE', value: window.start.getTime().toString() },
      { propertyName: 'hs_timestamp', operator: 'LT', value: window.end.getTime().toString() },
    ],
  }];
}

async function collectWindowRecursive(window, makeFilters, properties, depth = 0) {
  const { results, pages, hitLimit } = await searchAllEmails(makeFilters(window), properties);

  if (!hitLimit) {
    return { results, pages };
  }

  // Window too large — split and recurse (max depth 4 = ~2-day windows)
  if (depth >= 4) {
    return { results, pages };
  }

  const halves = splitWindow(window);
  let allResults = [];
  let totalPages = 0;
  for (const half of halves) {
    const r = await collectWindowRecursive(half, makeFilters, properties, depth + 1);
    allResults.push(...r.results);
    totalPages += r.pages;
  }
  return { results: allResults, pages: totalPages };
}

async function collectOutboundEmails() {
  console.log('\nPhase 2: Collecting outbound sequence emails (Aug 2025 – present)...');
  const windows = getMonthlyWindows(new Date('2025-08-01T00:00:00Z'), new Date());
  const allEmails = [];
  let totalPages = 0;

  for (const window of windows) {
    const label = window.start.toISOString().slice(0, 7);
    process.stdout.write(`  ${label}: `);

    const { results, pages } = await collectWindowRecursive(window, outboundFilters, OUTBOUND_PROPERTIES);
    console.log(`${results.length} emails (${pages} pages)`);
    allEmails.push(...results);
    totalPages += pages;
  }

  console.log(`  Total: ${allEmails.length} outbound sequence emails (${totalPages} API calls)`);
  return allEmails;
}

// ─── Phase 3: Inbound replies ───────────────────────────────────────────────

const INBOUND_PROPERTIES = [
  'hs_email_subject', 'hs_timestamp', 'hs_email_from_email', 'hs_email_direction',
];

function inboundFilters(window) {
  return [{
    filters: [
      { propertyName: 'hs_email_direction', operator: 'EQ', value: 'INCOMING_EMAIL' },
      { propertyName: 'hs_timestamp', operator: 'GTE', value: window.start.getTime().toString() },
      { propertyName: 'hs_timestamp', operator: 'LT', value: window.end.getTime().toString() },
    ],
  }];
}

async function collectInboundReplies() {
  console.log('\nPhase 3: Collecting inbound replies...');
  const windows = getMonthlyWindows(new Date('2025-08-01T00:00:00Z'), new Date());
  const allReplies = [];
  let totalPages = 0;

  for (const window of windows) {
    const label = window.start.toISOString().slice(0, 7);
    process.stdout.write(`  ${label}: `);

    const { results, pages } = await collectWindowRecursive(window, inboundFilters, INBOUND_PROPERTIES);
    console.log(`${results.length} replies (${pages} pages)`);
    allReplies.push(...results);
    totalPages += pages;
  }

  console.log(`  Total: ${allReplies.length} inbound replies (${totalPages} API calls)`);
  return allReplies;
}

// ─── Phase 4: Sequence names ────────────────────────────────────────────────

async function fetchSequenceNames(sequenceIds, ownerMap) {
  console.log(`\nPhase 4: Fetching names for ${sequenceIds.length} sequences...`);
  const nameMap = {};
  const targetIds = new Set(sequenceIds);

  // Sequences API is user-scoped — query each owner's sequences
  const userIds = [...new Set(
    Object.values(ownerMap).map(o => o.userId).filter(Boolean)
  )];
  console.log(`  Querying sequences for ${userIds.length} users...`);

  for (const userId of userIds) {
    if (nameMap.size >= targetIds.size) break; // found them all
    try {
      let after = undefined;
      while (true) {
        const path = after
          ? `/automation/v4/sequences?limit=100&userId=${userId}&after=${after}`
          : `/automation/v4/sequences?limit=100&userId=${userId}`;
        const data = await apiGet(path);
        for (const seq of (data.results || [])) {
          if (targetIds.has(seq.id) && !nameMap[seq.id]) {
            nameMap[seq.id] = seq.name;
          }
        }
        if (data.paging?.next?.after) {
          after = data.paging.next.after;
        } else {
          break;
        }
      }
    } catch {
      // Some users may not have sequence access; continue
    }
  }

  // Placeholder for any still unresolved
  for (const id of sequenceIds) {
    if (!nameMap[id]) nameMap[id] = `Sequence ${id}`;
  }

  const resolved = Object.values(nameMap).filter(n => !n.startsWith('Sequence ')).length;
  console.log(`  Resolved ${resolved}/${sequenceIds.length} sequence names`);
  return nameMap;
}

// ─── Phase 5: Compute metrics ───────────────────────────────────────────────

function computeMetrics(outboundEmails, inboundReplies, ownerMap, roleMap, sequenceNameMap) {
  console.log('\nPhase 5: Computing metrics...');

  // Index inbound replies by sender email → sorted timestamps
  const inboundByEmail = {};
  for (const reply of inboundReplies) {
    const from = (reply.properties.hs_email_from_email || '').toLowerCase().trim();
    if (!from) continue;
    const ts = new Date(reply.properties.hs_timestamp).getTime();
    if (!inboundByEmail[from]) inboundByEmail[from] = [];
    inboundByEmail[from].push(ts);
  }
  for (const email in inboundByEmail) {
    inboundByEmail[email].sort((a, b) => a - b);
  }

  const REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const templateData = {};   // "seqId::templateId" → metrics
  const sequenceData = {};   // seqId → aggregate metrics
  const seqTemplateOrder = {}; // seqId → { templateId → earliestTs }
  const repData = {};        // ownerId → aggregate metrics

  for (const email of outboundEmails) {
    const p = email.properties;
    const seqId = p.hs_sequence_id;
    const templateId = p.hs_template_id || 'unknown';
    const key = `${seqId}::${templateId}`;
    const openCount = parseInt(p.hs_email_open_count || '0', 10);
    const ownerId = p.hubspot_owner_id;
    const emailTs = new Date(p.hs_timestamp).getTime();
    // hs_email_to_email may contain multiple addresses separated by ;
    const toEmails = (p.hs_email_to_email || '').toLowerCase().split(';').map(e => e.trim()).filter(Boolean);

    // Template bucket
    if (!templateData[key]) {
      templateData[key] = {
        seqId, templateId,
        subject: p.hs_email_subject || '(no subject)',
        bodyPreview: (p.hs_body_preview || '').slice(0, 200),
        sent: 0, opens: 0, replies: 0,
      };
    }
    templateData[key].sent++;
    if (openCount > 0) templateData[key].opens++;

    // Step ordering
    if (!seqTemplateOrder[seqId]) seqTemplateOrder[seqId] = {};
    if (!seqTemplateOrder[seqId][templateId] || emailTs < seqTemplateOrder[seqId][templateId]) {
      seqTemplateOrder[seqId][templateId] = emailTs;
    }

    // Reply matching: binary search for inbound from same recipient within 14 days
    let hasReply = false;
    for (const toEmail of toEmails) {
      const replies = inboundByEmail[toEmail];
      if (!replies) continue;
      const cutoff = emailTs + REPLY_WINDOW_MS;
      let lo = 0, hi = replies.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (replies[mid] <= emailTs) lo = mid + 1;
        else hi = mid;
      }
      if (lo < replies.length && replies[lo] <= cutoff) {
        hasReply = true;
        break;
      }
    }
    if (hasReply) templateData[key].replies++;

    // Sequence aggregate
    if (!sequenceData[seqId]) {
      sequenceData[seqId] = { templates: new Set(), emailCount: 0, opens: 0, replies: 0 };
    }
    sequenceData[seqId].templates.add(templateId);
    sequenceData[seqId].emailCount++;
    if (openCount > 0) sequenceData[seqId].opens++;
    if (hasReply) sequenceData[seqId].replies++;

    // Rep aggregate
    if (ownerId) {
      if (!repData[ownerId]) repData[ownerId] = { sent: 0, opens: 0, replies: 0 };
      repData[ownerId].sent++;
      if (openCount > 0) repData[ownerId].opens++;
      if (hasReply) repData[ownerId].replies++;
    }
  }

  // Assign step numbers by earliest timestamp within each sequence
  for (const seqId in seqTemplateOrder) {
    const entries = Object.entries(seqTemplateOrder[seqId]).sort((a, b) => a[1] - b[1]);
    entries.forEach(([templateId], idx) => {
      const key = `${seqId}::${templateId}`;
      if (templateData[key]) templateData[key].stepNumber = idx + 1;
    });
  }

  // Step position aggregation across all sequences
  const stepPositionData = {};
  for (const t of Object.values(templateData)) {
    const step = t.stepNumber || 0;
    if (step === 0) continue;
    if (!stepPositionData[step]) stepPositionData[step] = { sent: 0, opens: 0, replies: 0 };
    stepPositionData[step].sent += t.sent;
    stepPositionData[step].opens += t.opens;
    stepPositionData[step].replies += t.replies;
  }

  // Rep performance with name/role enrichment
  const repPerformance = Object.entries(repData).map(([ownerId, d]) => {
    const owner = ownerMap[ownerId] || {};
    const team = roleMap[owner.email || ''] || {};
    return {
      ownerId,
      name: team.name || owner.name || `Owner ${ownerId}`,
      role: team.role || 'Unknown',
      ...d,
      openRate: d.sent > 0 ? d.opens / d.sent : 0,
      replyRate: d.sent > 0 ? d.replies / d.sent : 0,
    };
  }).sort((a, b) => b.sent - a.sent);

  // Sequence performance
  const sequencePerformance = Object.entries(sequenceData).map(([seqId, s]) => ({
    seqId,
    name: sequenceNameMap[seqId] || `Sequence ${seqId}`,
    steps: s.templates.size,
    emailsSent: s.emailCount,
    opens: s.opens,
    replies: s.replies,
    openRate: s.emailCount > 0 ? s.opens / s.emailCount : 0,
    replyRate: s.emailCount > 0 ? s.replies / s.emailCount : 0,
  })).sort((a, b) => b.emailsSent - a.emailsSent);

  // Top subject lines (min 50 sends)
  const allTemplates = Object.values(templateData);
  const qualified = allTemplates.filter(t => t.sent >= 50);

  const topByOpenRate = [...qualified]
    .sort((a, b) => (b.opens / b.sent) - (a.opens / a.sent))
    .slice(0, 10);

  const topByReplyRate = [...qualified]
    .sort((a, b) => (b.replies / b.sent) - (a.replies / a.sent))
    .slice(0, 10);

  const totalSent = outboundEmails.length;
  const totalOpens = allTemplates.reduce((s, t) => s + t.opens, 0);
  const totalReplies = allTemplates.reduce((s, t) => s + t.replies, 0);

  console.log(`  ${totalSent.toLocaleString()} emails, ${totalOpens.toLocaleString()} opens (${(totalOpens / totalSent * 100).toFixed(1)}%), ${totalReplies.toLocaleString()} replies (${(totalReplies / totalSent * 100).toFixed(1)}%)`);

  function formatTop(list) {
    return list.map(t => ({
      subject: t.subject,
      sequence: sequenceNameMap[t.seqId] || t.seqId,
      step: t.stepNumber,
      sent: t.sent,
      openRate: t.opens / t.sent,
      replyRate: t.replies / t.sent,
    }));
  }

  return {
    summary: {
      totalEmailsSent: totalSent,
      totalOpens,
      totalReplies,
      overallOpenRate: totalSent > 0 ? totalOpens / totalSent : 0,
      overallReplyRate: totalSent > 0 ? totalReplies / totalSent : 0,
      uniqueSequences: Object.keys(sequenceData).length,
      dateRange: { start: '2025-08-01', end: new Date().toISOString().slice(0, 10) },
    },
    topSubjectsByOpenRate: formatTop(topByOpenRate),
    topSubjectsByReplyRate: formatTop(topByReplyRate),
    stepPositionAnalysis: Object.entries(stepPositionData)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([step, d]) => ({
        step: parseInt(step),
        sent: d.sent,
        openRate: d.sent > 0 ? d.opens / d.sent : 0,
        replyRate: d.sent > 0 ? d.replies / d.sent : 0,
      })),
    sequencePerformance,
    repPerformance,
    templateDetails: allTemplates.map(t => ({
      sequence: sequenceNameMap[t.seqId] || t.seqId,
      sequenceId: t.seqId,
      templateId: t.templateId,
      step: t.stepNumber,
      subject: t.subject,
      bodyPreview: t.bodyPreview,
      sent: t.sent,
      openRate: t.sent > 0 ? t.opens / t.sent : 0,
      replyRate: t.sent > 0 ? t.replies / t.sent : 0,
    })),
  };
}

// ─── Report generation ──────────────────────────────────────────────────────

function pct(n) { return (n * 100).toFixed(1) + '%'; }
function esc(s) { return (s || '').replace(/\|/g, '\\|'); }

function generateReport(metrics) {
  const { summary: s, topSubjectsByOpenRate, topSubjectsByReplyRate,
    stepPositionAnalysis, sequencePerformance, repPerformance } = metrics;

  let md = `# Sales Sequence Email Performance Report\n\n`;
  md += `**Period:** ${s.dateRange.start} to ${s.dateRange.end}  \n`;
  md += `**Generated:** ${new Date().toISOString().slice(0, 10)}\n\n`;

  // Executive summary
  md += `## Executive Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total sequence emails sent | ${s.totalEmailsSent.toLocaleString()} |\n`;
  md += `| Total opens | ${s.totalOpens.toLocaleString()} |\n`;
  md += `| Total replies (est.) | ${s.totalReplies.toLocaleString()} |\n`;
  md += `| Overall open rate | ${pct(s.overallOpenRate)} |\n`;
  md += `| Overall reply rate | ${pct(s.overallReplyRate)} |\n`;
  md += `| Unique sequences | ${s.uniqueSequences} |\n\n`;

  // Top subjects by open rate
  md += `## Top Subject Lines by Open Rate\n\n`;
  md += `_Minimum 50 sends_\n\n`;
  if (topSubjectsByOpenRate.length === 0) {
    md += `No subject lines met the minimum send threshold.\n\n`;
  } else {
    md += `| # | Subject | Sequence | Step | Sent | Open % | Reply % |\n`;
    md += `|---|---------|----------|------|------|--------|--------|\n`;
    topSubjectsByOpenRate.forEach((t, i) => {
      md += `| ${i + 1} | ${esc(t.subject).slice(0, 60)} | ${esc(t.sequence).slice(0, 30)} | ${t.step || '-'} | ${t.sent} | ${pct(t.openRate)} | ${pct(t.replyRate)} |\n`;
    });
    md += '\n';
  }

  // Top subjects by reply rate
  md += `## Top Subject Lines by Reply Rate\n\n`;
  md += `_Minimum 50 sends_\n\n`;
  if (topSubjectsByReplyRate.length === 0) {
    md += `No subject lines met the minimum send threshold.\n\n`;
  } else {
    md += `| # | Subject | Sequence | Step | Sent | Open % | Reply % |\n`;
    md += `|---|---------|----------|------|------|--------|--------|\n`;
    topSubjectsByReplyRate.forEach((t, i) => {
      md += `| ${i + 1} | ${esc(t.subject).slice(0, 60)} | ${esc(t.sequence).slice(0, 30)} | ${t.step || '-'} | ${t.sent} | ${pct(t.openRate)} | ${pct(t.replyRate)} |\n`;
    });
    md += '\n';
  }

  // Step position analysis
  md += `## Engagement by Step Position\n\n`;
  md += `_Open and reply rates across sequence steps (all sequences combined)_\n\n`;
  md += `| Step | Emails Sent | Open Rate | Reply Rate |\n`;
  md += `|------|-------------|-----------|------------|\n`;
  stepPositionAnalysis.forEach(row => {
    md += `| ${row.step} | ${row.sent.toLocaleString()} | ${pct(row.openRate)} | ${pct(row.replyRate)} |\n`;
  });
  md += '\n';

  // Sequence breakdown
  md += `## Sequence Performance\n\n`;
  md += `| Sequence | Steps | Emails Sent | Open % | Reply % |\n`;
  md += `|----------|-------|-------------|--------|--------|\n`;
  sequencePerformance.forEach(seq => {
    md += `| ${esc(seq.name).slice(0, 50)} | ${seq.steps} | ${seq.emailsSent.toLocaleString()} | ${pct(seq.openRate)} | ${pct(seq.replyRate)} |\n`;
  });
  md += '\n';

  // Rep performance
  md += `## Rep Performance\n\n`;
  md += `| Name | Role | Emails Sent | Open % | Reply % |\n`;
  md += `|------|------|-------------|--------|--------|\n`;
  repPerformance.forEach(r => {
    md += `| ${r.name} | ${r.role} | ${r.sent.toLocaleString()} | ${pct(r.openRate)} | ${pct(r.replyRate)} |\n`;
  });
  md += '\n';

  md += `---\n\n`;
  md += `_Reply rate is estimated by matching inbound emails from the same recipient within 14 days of the outbound send. Actual reply rates may differ._\n`;

  return md;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('=== Sales Sequence Email Performance Analysis ===\n');

  // Phase 1: Bootstrap
  const ownerMap = await fetchOwners();
  const roleMap = parseSalesTeam();

  // Phase 2: Outbound sequence emails
  const outboundEmails = await collectOutboundEmails();

  // Phase 3: Inbound replies
  const inboundReplies = await collectInboundReplies();

  // Phase 4: Sequence names
  const uniqueSeqIds = [...new Set(
    outboundEmails.map(e => e.properties.hs_sequence_id).filter(Boolean)
  )];
  const sequenceNameMap = await fetchSequenceNames(uniqueSeqIds, ownerMap);

  // Phase 5: Compute metrics
  const metrics = computeMetrics(
    outboundEmails, inboundReplies, ownerMap, roleMap, sequenceNameMap
  );

  // Write outputs
  console.log('\nWriting output files...');
  const jsonPath = join(projectRoot, 'sequence-effectiveness-data.json');
  const reportPath = join(projectRoot, 'sequence-effectiveness-report.md');

  writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
  console.log(`  JSON:   ${jsonPath}`);

  const report = generateReport(metrics);
  writeFileSync(reportPath, report);
  console.log(`  Report: ${reportPath}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  if (err.body) console.error('Details:', JSON.stringify(err.body, null, 2));
  process.exit(1);
});
