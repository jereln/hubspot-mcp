/**
 * ASCII visualization engine for HubSpot v4 workflow actions.
 * Renders a directed graph of actions as box-and-arrow diagrams.
 */

// ── Action type labels ─────────────────────────────────────────────
// HubSpot v4 uses both numeric IDs ("0-5") and string IDs ("SET_CONTACT_PROPERTY")

const ACTION_LABELS: Record<string, string> = {
  // Numeric action type IDs (v4 API)
  "0-1": "Delay",
  "0-2": "IF/THEN",
  "0-3": "Send Email",
  "0-4": "Send Internal Email",
  "0-5": "Set Property",
  "0-6": "Copy Property",
  "0-7": "Create Task",
  "0-8": "Send Notification",
  "0-9": "Add to List",
  "0-10": "Remove from List",
  "0-11": "Webhook",
  "0-12": "Delay Until Date",
  "0-13": "Create Record",
  "0-14": "Delete Record",
  "0-15": "Enroll in Workflow",
  "0-16": "Unenroll from Workflow",
  "0-17": "Rotate Owner",
  "0-18": "Custom Code",
  "0-19": "Format Data",
  "0-20": "A/B Test",
  "0-21": "Value Branch",
  "0-22": "Send In-App Email",
  "0-35": "Manage Subscription",
  // String action type IDs (legacy / some contexts)
  SEND_EMAIL: "Send Email",
  SEND_IN_APP_EMAIL: "Send In-App Email",
  DELAY: "Delay",
  DELAY_UNTIL_DATE: "Delay Until Date",
  IF_THEN_BRANCH: "IF/THEN",
  VALUE_BRANCH: "Value Branch",
  RANDOM_BRANCH: "A/B Test",
  SET_CONTACT_PROPERTY: "Set Property",
  SET_COMPANY_PROPERTY: "Set Property",
  SET_DEAL_PROPERTY: "Set Property",
  SET_TICKET_PROPERTY: "Set Property",
  COPY_PROPERTY: "Copy Property",
  CREATE_RECORD: "Create Record",
  DELETE_RECORD: "Delete Record",
  ENROLL_IN_WORKFLOW: "Enroll in Workflow",
  UNENROLL_FROM_WORKFLOW: "Unenroll from Workflow",
  ADD_TO_LIST: "Add to List",
  REMOVE_FROM_LIST: "Remove from List",
  CREATE_TASK: "Create Task",
  SEND_NOTIFICATION: "Send Notification",
  SEND_INTERNAL_EMAIL: "Send Internal Email",
  WEBHOOK: "Webhook",
  CUSTOM_CODE: "Custom Code",
  ROTATE_OWNER: "Rotate Owner",
  FORMAT_DATA: "Format Data",
  MANAGE_SUBSCRIPTION: "Manage Subscription",
};

function getActionLabel(actionTypeId: string | undefined | null): string {
  if (!actionTypeId) return "Branch";
  return ACTION_LABELS[actionTypeId] || actionTypeId;
}

// ── Detail extraction ──────────────────────────────────────────────
// v4 API returns fields as an object: { property_name: "x", value: { staticValue: "y", type: "STATIC_VALUE" } }

function getFieldValue(fields: Record<string, unknown> | undefined, key: string): unknown {
  if (!fields) return undefined;
  const val = fields[key];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("staticValue" in obj) return obj.staticValue;
    // TIMESTAMP type → human-readable label
    if (obj.type === "TIMESTAMP") {
      const ts = obj.timestampType as string | undefined;
      if (ts === "EXECUTION_TIME") return "(current date/time)";
      return ts ? `(${ts.toLowerCase().replace(/_/g, " ")})` : "(timestamp)";
    }
    // If it's still an object with a type, summarize it
    if ("type" in obj) return `(${String(obj.type).toLowerCase().replace(/_/g, " ")})`;
  }
  return val;
}

function extractDetail(action: WorkflowAction): string | null {
  const fields = action.fields as Record<string, unknown> | undefined;
  const typeId = action.actionTypeId ?? "";

  // No type ID (branch actions)
  if (!typeId) return null;

  // Set Property (numeric "0-5" or string "SET_*_PROPERTY")
  if (typeId === "0-5" || (typeId.startsWith("SET_") && typeId.endsWith("_PROPERTY"))) {
    const prop = getFieldValue(fields, "property_name") ?? getFieldValue(fields, "propertyName");
    const val = getFieldValue(fields, "value") ?? getFieldValue(fields, "propertyValue");
    if (prop && val) {
      const valStr = String(val);
      const truncated = valStr.length > 50 ? valStr.slice(0, 47) + "..." : valStr;
      return `${prop} = ${truncated}`;
    }
    if (prop) return `${prop}`;
    return null;
  }

  // Delay
  if (typeId === "0-1" || typeId === "DELAY") {
    // v4 uses delta + time_unit
    const delta = getFieldValue(fields, "delta");
    const timeUnit = getFieldValue(fields, "time_unit");
    if (delta && timeUnit) return `${delta} ${String(timeUnit).toLowerCase()}`;
    // Legacy fields
    const amount = getFieldValue(fields, "delay.amount") ?? getFieldValue(fields, "delayMillis");
    const unit = getFieldValue(fields, "delay.unit");
    if (amount && unit) return `${amount} ${unit}`.toLowerCase();
    if (amount) {
      const ms = Number(amount);
      if (!isNaN(ms)) {
        if (ms >= 86400000) return `${Math.round(ms / 86400000)} days`;
        if (ms >= 3600000) return `${Math.round(ms / 3600000)} hours`;
        if (ms >= 60000) return `${Math.round(ms / 60000)} minutes`;
        return `${Math.round(ms / 1000)} seconds`;
      }
    }
    return null;
  }

  // Send Email / Send Internal Email
  if (typeId === "0-3" || typeId === "0-4" || typeId === "0-22" || typeId === "SEND_EMAIL" || typeId === "SEND_IN_APP_EMAIL" || typeId === "SEND_INTERNAL_EMAIL") {
    const emailId = getFieldValue(fields, "emailId") ?? getFieldValue(fields, "email") ?? getFieldValue(fields, "content_id");
    return emailId ? `ID: ${emailId}` : null;
  }

  // Copy Property
  if (typeId === "0-6" || typeId === "COPY_PROPERTY") {
    const src = getFieldValue(fields, "sourceProperty") ?? getFieldValue(fields, "source_property");
    const dst = getFieldValue(fields, "targetProperty") ?? getFieldValue(fields, "target_property");
    if (src && dst) return `${src} → ${dst}`;
    return null;
  }

  // Webhook
  if (typeId === "0-11" || typeId === "WEBHOOK") {
    const method = getFieldValue(fields, "httpMethod") ?? getFieldValue(fields, "method") ?? "POST";
    const url = getFieldValue(fields, "url") ?? getFieldValue(fields, "webhookUrl");
    if (url) {
      const urlStr = String(url);
      const truncated = urlStr.length > 40 ? urlStr.slice(0, 37) + "..." : urlStr;
      return `${method} ${truncated}`;
    }
    return null;
  }

  // Custom Code
  if (typeId === "0-18" || typeId === "CUSTOM_CODE") {
    const runtime = getFieldValue(fields, "runtime") ?? getFieldValue(fields, "language");
    return runtime ? `Runtime: ${runtime}` : null;
  }

  // Create Task
  if (typeId === "0-7" || typeId === "CREATE_TASK") {
    const subject = getFieldValue(fields, "subject") ?? getFieldValue(fields, "taskSubject");
    return subject ? `"${String(subject).slice(0, 30)}"` : null;
  }

  return null;
}

// ── Types ──────────────────────────────────────────────────────────

interface Connection {
  nextActionId: string;
  edgeType?: string;
}

interface BranchConnection extends Connection {
  branchName?: string;
  style?: string;
}

interface ListBranch {
  branchName?: string;
  connection?: Connection;
  filterBranch?: unknown;
}

export interface WorkflowAction {
  actionId: string;
  actionTypeId?: string | null;
  type: string; // SINGLE_CONNECTION, LIST_BRANCH, STATIC_BRANCH, AB_TEST_BRANCH, etc.
  fields?: Record<string, unknown>;
  connection?: Connection;
  connections?: BranchConnection[];
  // v4 LIST_BRANCH fields
  listBranches?: ListBranch[];
  defaultBranch?: Connection;
  defaultBranchName?: string;
}

export interface EnrollmentCriteria {
  type?: string; // EVENT_BASED, LIST_BASED
  shouldReEnroll?: boolean;
  eventFilterBranches?: Array<{
    eventTypeId?: string;
    operator?: string;
    filterBranchType?: string;
    filters?: Array<{ property?: string; filterType?: string; operator?: string; listId?: string }>;
  }>;
  listMembershipFilterBranches?: Array<{
    filters?: Array<{ listId?: string; operator?: string; filterType?: string }>;
  }>;
  listFilterBranch?: {
    filterBranches?: Array<{
      filters?: Array<{
        property?: string;
        filterType?: string;
        operation?: { operator?: string };
      }>;
    }>;
  };
}

export interface WorkflowFlow {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId?: string;
  triggerType?: string;
  startActionId?: string;
  actions: WorkflowAction[];
  enrollmentCriteria?: EnrollmentCriteria;
}

// ── Renderer ───────────────────────────────────────────────────────

const MAX_DEPTH = 50;

interface RenderContext {
  actionMap: Map<string, WorkflowAction>;
  visited: Map<string, number>; // actionId → step number
  stepCounter: number;
}

function centerText(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

function wrapLines(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function renderBox(
  lines: string[],
  minWidth = 16
): string[] {
  const contentWidth = Math.max(
    minWidth,
    ...lines.map((l) => l.length)
  );
  const border = "─".repeat(contentWidth + 2);
  const result: string[] = [];
  result.push(`┌${border}┐`);
  for (const line of lines) {
    result.push(`│ ${centerText(line, contentWidth)} │`);
  }
  result.push(`└${"─".repeat(Math.floor((contentWidth + 2) / 2))}┬${"─".repeat(Math.ceil((contentWidth + 2) / 2 - 1))}┘`);
  return result;
}

function renderTerminalBox(lines: string[], minWidth = 16): string[] {
  const contentWidth = Math.max(minWidth, ...lines.map((l) => l.length));
  const border = "─".repeat(contentWidth + 2);
  const result: string[] = [];
  result.push(`┌${border}┐`);
  for (const line of lines) {
    result.push(`│ ${centerText(line, contentWidth)} │`);
  }
  result.push(`└${border}┘`);
  return result;
}

function indentLines(lines: string[], spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((l) => pad + l);
}

function centerLines(lines: string[], totalWidth: number): string[] {
  if (lines.length === 0) return [];
  const maxLineWidth = Math.max(...lines.map((l) => l.length));
  const pad = Math.max(0, Math.floor((totalWidth - maxLineWidth) / 2));
  return indentLines(lines, pad);
}

function renderAction(
  actionId: string,
  ctx: RenderContext,
  depth: number
): string[] {
  if (depth > MAX_DEPTH) {
    return ["[... max depth reached]"];
  }

  const action = ctx.actionMap.get(actionId);
  if (!action) {
    return [`[unknown action: ${actionId}]`];
  }

  // Already visited → convergence reference
  if (ctx.visited.has(actionId)) {
    return [`[→ step ${ctx.visited.get(actionId)}]`];
  }

  ctx.stepCounter++;
  const stepNum = ctx.stepCounter;
  ctx.visited.set(actionId, stepNum);

  const label = getActionLabel(action.actionTypeId ?? null);
  const detail = extractDetail(action);
  const boxLines: string[] = [`${stepNum}. ${label}`];
  if (detail) {
    for (const dl of wrapLines(detail, 28)) {
      boxLines.push(`   ${dl}`);
    }
  }

  const isBranch =
    action.type === "LIST_BRANCH" ||
    action.type === "STATIC_BRANCH" ||
    action.type === "AB_TEST_BRANCH";

  // v4 LIST_BRANCH uses listBranches + defaultBranch
  if (isBranch && action.listBranches && action.listBranches.length > 0) {
    // Convert v4 listBranches to normalized connections
    const normalized: BranchConnection[] = action.listBranches.map((lb) => ({
      nextActionId: lb.connection?.nextActionId ?? "",
      branchName: lb.branchName,
    }));
    if (action.defaultBranch) {
      normalized.push({
        nextActionId: action.defaultBranch.nextActionId,
        branchName: action.defaultBranchName ?? "Default",
      });
    }
    const normalizedAction = { ...action, connections: normalized };
    return renderBranch(normalizedAction, boxLines, stepNum, ctx, depth);
  }

  if (isBranch && action.connections && action.connections.length > 0) {
    return renderBranch(action, boxLines, stepNum, ctx, depth);
  }

  // Single connection or terminal
  const nextId = action.connection?.nextActionId;
  if (!nextId) {
    return renderTerminalBox(boxLines);
  }

  const box = renderBox(boxLines);
  const boxWidth = box[0].length;
  const connectorCol = Math.floor(boxWidth / 2);
  const output: string[] = [...box];
  output.push(" ".repeat(connectorCol) + "│");
  output.push(" ".repeat(connectorCol) + "▼");

  const nextLines = renderAction(nextId, ctx, depth + 1);
  const centeredNext = centerLines(nextLines, boxWidth);
  output.push(...centeredNext);

  return output;
}

function renderBranch(
  action: WorkflowAction,
  boxLines: string[],
  stepNum: number,
  ctx: RenderContext,
  depth: number
): string[] {
  const connections = action.connections!;

  // Render the branch header as a terminal box (no bottom connector)
  const headerBox = renderTerminalBox(boxLines);
  const headerWidth = headerBox[0].length;

  // Render each branch column
  const columns: { label: string; lines: string[] }[] = [];
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    let label = conn.branchName || `Branch ${i + 1}`;
    if (action.type === "AB_TEST_BRANCH") {
      label = conn.branchName || `${Math.round(100 / connections.length)}%`;
    }
    if (!conn.nextActionId) {
      columns.push({ label, lines: ["(end)"] });
    } else {
      const branchLines = renderAction(conn.nextActionId, ctx, depth + 1);
      columns.push({ label, lines: branchLines });
    }
  }

  // Calculate column widths
  const colWidths = columns.map((col) => {
    const labelWidth = col.label.length + 2; // brackets
    const contentWidth = Math.max(...col.lines.map((l) => l.length), 0);
    return Math.max(labelWidth, contentWidth, 8);
  });
  const gap = 2;
  const totalBranchWidth = colWidths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  const totalWidth = Math.max(headerWidth, totalBranchWidth);

  const output: string[] = [];

  // Center the header box
  output.push(...centerLines(headerBox, totalWidth));

  // Draw split line
  const splitLine: string[] = [];
  let cursor = Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2));
  for (let i = 0; i < columns.length; i++) {
    const colCenter = cursor + Math.floor(colWidths[i] / 2);
    // Draw connection lines
    if (i === 0) {
      splitLine.push(" ".repeat(colCenter) + "┌");
    }
    if (i > 0) {
      const prevEnd = splitLine.join("").length;
      const fill = colCenter - prevEnd;
      if (fill > 0) splitLine.push("─".repeat(fill));
      if (i < columns.length - 1) {
        splitLine.push("┬");
      } else {
        splitLine.push("┐");
      }
    }
    cursor += colWidths[i] + gap;
  }
  if (columns.length === 1) {
    splitLine.push("┐");
  }
  output.push(splitLine.join(""));

  // Draw labels row
  cursor = Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2));
  const labelParts: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const label = `[${columns[i].label}]`;
    const centered = centerText(label, colWidths[i]);
    if (i > 0) labelParts.push(" ".repeat(gap));
    labelParts.push(centered);
  }
  output.push(" ".repeat(Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2))) + labelParts.join(""));

  // Draw vertical connectors
  cursor = Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2));
  const connectorLine: string[] = [];
  let pos = 0;
  for (let i = 0; i < columns.length; i++) {
    const colStart = cursor;
    const colCenter = colStart + Math.floor(colWidths[i] / 2);
    const fill = colCenter - pos;
    if (fill > 0) connectorLine.push(" ".repeat(fill));
    connectorLine.push("▼");
    pos = colCenter + 1;
    cursor += colWidths[i] + gap;
  }
  output.push(connectorLine.join(""));

  // Render branch columns side by side
  const maxHeight = Math.max(...columns.map((c) => c.lines.length));
  cursor = Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2));

  for (let row = 0; row < maxHeight; row++) {
    let colCursor = Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2));
    const rowParts: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const line = row < columns[i].lines.length ? columns[i].lines[row] : "";
      const padded = line + " ".repeat(Math.max(0, colWidths[i] - line.length));
      if (i > 0) rowParts.push(" ".repeat(gap));
      rowParts.push(padded);
    }
    output.push(" ".repeat(Math.max(0, Math.floor((totalWidth - totalBranchWidth) / 2))) + rowParts.join(""));
  }

  return output;
}

// ── Public API ─────────────────────────────────────────────────────

// Known HubSpot event type prefixes
const EVENT_TYPE_LABELS: Record<string, string> = {
  "4": "Form submission",
  "6": "Page view",
  "10": "Email open",
  "11": "Email click",
  "1": "Contact property change",
  "3": "Deal property change",
};

function describeTrigger(ec: EnrollmentCriteria | undefined): string[] {
  if (!ec) return [];
  const lines: string[] = [];

  const reEnroll = ec.shouldReEnroll ? "Re-enroll: on" : "Re-enroll: off";

  if (ec.type === "EVENT_BASED") {
    // Event-based triggers
    const events = ec.eventFilterBranches ?? [];
    if (events.length > 0) {
      for (const branch of events) {
        const eventId = branch.eventTypeId ?? "";
        const prefix = eventId.split("-")[0];
        const eventLabel = EVENT_TYPE_LABELS[prefix] || `Event ${eventId}`;
        const op = branch.operator === "HAS_COMPLETED" ? "completed" : (branch.operator ?? "").toLowerCase();
        lines.push(`When: ${eventLabel} ${op}`);
      }
    }
    // List membership triggers within event-based
    const listBranches = ec.listMembershipFilterBranches ?? [];
    for (const branch of listBranches) {
      for (const filter of branch.filters ?? []) {
        if (filter.filterType === "IN_LIST" && filter.listId) {
          lines.push(`When: Added to list ${filter.listId}`);
        }
      }
    }
    if (lines.length === 0) {
      lines.push("Trigger: Event-based");
    }
  } else if (ec.type === "LIST_BASED") {
    // List/filter-based triggers
    const branches = ec.listFilterBranch?.filterBranches ?? [];
    for (const branch of branches) {
      for (const filter of branch.filters ?? []) {
        if (filter.filterType === "PROPERTY" && filter.property) {
          const op = filter.operation?.operator?.toLowerCase().replace(/_/g, " ") ?? "";
          lines.push(`When: ${filter.property} ${op}`);
        }
      }
    }
    if (lines.length === 0) {
      lines.push("Trigger: Filter-based");
    }
  } else if (ec.type) {
    lines.push(`Trigger: ${ec.type.toLowerCase().replace(/_/g, " ")}`);
  }

  lines.push(reEnroll);
  return lines;
}

export function renderWorkflow(flow: WorkflowFlow): string {
  const lines: string[] = [];

  // Header
  const status = flow.isEnabled ? "enabled" : "disabled";
  const title = `${flow.name} (${status})`;
  const headerLines = [title];

  // Add trigger info
  const triggerLines = describeTrigger(flow.enrollmentCriteria);
  if (triggerLines.length > 0) {
    headerLines.push(""); // blank separator
    headerLines.push(...triggerLines);
  } else if (flow.triggerType) {
    headerLines.push(`Trigger: ${flow.triggerType}`);
  }

  const contentWidth = Math.max(30, ...headerLines.map((l) => l.length));
  const border = "═".repeat(contentWidth + 2);
  const midBorder = "═".repeat(Math.floor((contentWidth + 2) / 2)) + "╤" + "═".repeat(Math.ceil((contentWidth + 2) / 2 - 1));

  lines.push(`╔${border}╗`);
  for (const hl of headerLines) {
    lines.push(`║ ${centerText(hl, contentWidth)} ║`);
  }
  lines.push(`╚${midBorder}╝`);

  if (!flow.startActionId || flow.actions.length === 0) {
    lines.push("        │");
    lines.push("    (no actions)");
    return lines.join("\n");
  }

  // Build action map
  const ctx: RenderContext = {
    actionMap: new Map(flow.actions.map((a) => [a.actionId, a])),
    visited: new Map(),
    stepCounter: 0,
  };

  const headerWidth = lines[0].length;

  // Connector from header
  const headerCenter = Math.floor(headerWidth / 2);
  lines.push(" ".repeat(headerCenter) + "│");
  lines.push(" ".repeat(headerCenter) + "▼");

  const bodyLines = renderAction(flow.startActionId, ctx, 0);
  const centeredBody = centerLines(bodyLines, headerWidth);
  lines.push(...centeredBody);

  return lines.join("\n");
}
