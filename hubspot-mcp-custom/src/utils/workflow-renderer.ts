/**
 * ASCII visualization engine for HubSpot v4 workflow actions.
 * Renders a directed graph of actions as box-and-arrow diagrams.
 */

// ── Action type labels ─────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  // Communication
  SEND_EMAIL: "Send Email",
  SEND_IN_APP_EMAIL: "Send In-App Email",
  // Delays
  DELAY: "Delay",
  DELAY_UNTIL_DATE: "Delay Until Date",
  DELAY_UNTIL_EVENT: "Delay Until Event",
  // Branching
  IF_THEN_BRANCH: "IF/THEN",
  VALUE_BRANCH: "Value Branch",
  RANDOM_BRANCH: "A/B Test",
  // CRM operations
  SET_CONTACT_PROPERTY: "Set Contact Property",
  SET_COMPANY_PROPERTY: "Set Company Property",
  SET_DEAL_PROPERTY: "Set Deal Property",
  SET_TICKET_PROPERTY: "Set Ticket Property",
  SET_CUSTOM_OBJECT_PROPERTY: "Set Custom Object Property",
  COPY_PROPERTY: "Copy Property",
  CREATE_RECORD: "Create Record",
  DELETE_RECORD: "Delete Record",
  // Enrollment
  ENROLL_IN_WORKFLOW: "Enroll in Workflow",
  UNENROLL_FROM_WORKFLOW: "Unenroll from Workflow",
  REMOVE_FROM_WORKFLOW: "Remove from Workflow",
  // Lists
  ADD_TO_LIST: "Add to List",
  REMOVE_FROM_LIST: "Remove from List",
  // Tasks & notifications
  CREATE_TASK: "Create Task",
  SEND_NOTIFICATION: "Send Notification",
  SEND_INTERNAL_EMAIL: "Send Internal Email",
  SEND_INTERNAL_SMS: "Send Internal SMS",
  // Ads
  ADD_TO_ADS_AUDIENCE: "Add to Ads Audience",
  REMOVE_FROM_ADS_AUDIENCE: "Remove from Ads Audience",
  // Integrations
  WEBHOOK: "Webhook",
  CUSTOM_CODE: "Custom Code",
  TRIGGER_WORKFLOW: "Trigger Workflow",
  // Association
  SET_ASSOCIATION_LABEL: "Set Association Label",
  REMOVE_ASSOCIATION: "Remove Association",
  // Data management
  FORMAT_DATA: "Format Data",
  MANAGE_SUBSCRIPTION: "Manage Subscription",
  // Rotation
  ROTATE_OWNER: "Rotate Owner",
  // Communication subscriptions
  MANAGE_COMMUNICATION_SUBSCRIPTION: "Manage Communication Sub",
  // Salesforce
  CREATE_SALESFORCE_OBJECT: "Create Salesforce Object",
};

function getActionLabel(actionTypeId: string): string {
  return ACTION_LABELS[actionTypeId] || actionTypeId;
}

// ── Detail extraction ──────────────────────────────────────────────

interface ActionField {
  name: string;
  value: unknown;
  type?: string;
}

function extractDetail(action: WorkflowAction): string | null {
  const fields = (action.fields ?? []) as ActionField[];
  const getField = (name: string) =>
    fields.find((f) => f.name === name)?.value;

  const typeId = action.actionTypeId;

  if (typeId === "DELAY") {
    const amount = getField("delay.amount") ?? getField("delayMillis");
    const unit = getField("delay.unit");
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

  if (typeId === "SEND_EMAIL" || typeId === "SEND_IN_APP_EMAIL") {
    const emailId = getField("emailId") ?? getField("email");
    return emailId ? `ID: ${emailId}` : null;
  }

  if (typeId.startsWith("SET_") && typeId.endsWith("_PROPERTY")) {
    const prop = getField("propertyName") ?? getField("property");
    const val = getField("propertyValue") ?? getField("value");
    if (prop && val) return `${prop} = ${val}`;
    if (prop) return `${prop}`;
    return null;
  }

  if (typeId === "WEBHOOK") {
    const method = getField("httpMethod") ?? getField("method") ?? "POST";
    const url = getField("url") ?? getField("webhookUrl");
    if (url) {
      const urlStr = String(url);
      const truncated = urlStr.length > 40 ? urlStr.slice(0, 37) + "..." : urlStr;
      return `${method} ${truncated}`;
    }
    return null;
  }

  if (typeId === "CUSTOM_CODE") {
    const runtime = getField("runtime") ?? getField("language");
    return runtime ? `Runtime: ${runtime}` : null;
  }

  if (typeId === "CREATE_TASK") {
    const subject = getField("subject") ?? getField("taskSubject");
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

export interface WorkflowAction {
  actionId: string;
  actionTypeId: string;
  type: string; // SINGLE_CONNECTION, LIST_BRANCH, STATIC_BRANCH, AB_TEST_BRANCH, etc.
  fields?: unknown[];
  connection?: Connection;
  connections?: BranchConnection[];
}

export interface WorkflowFlow {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId?: string;
  triggerType?: string;
  startActionId?: string;
  actions: WorkflowAction[];
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

  const label = getActionLabel(action.actionTypeId);
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

export function renderWorkflow(flow: WorkflowFlow): string {
  const lines: string[] = [];

  // Header
  const status = flow.isEnabled ? "enabled" : "disabled";
  const title = `${flow.name} (${status})`;
  const trigger = flow.triggerType ? `Trigger: ${flow.triggerType}` : "";
  const headerLines = [title];
  if (trigger) headerLines.push(trigger);

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
