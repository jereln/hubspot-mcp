/**
 * Lazy-loading cache for HubSpot v4 workflows with fuzzy name search.
 */

import { HubSpotClient } from "../client.js";
import { fuzzyMatch } from "./fuzzy.js";
import type { WorkflowAction } from "./workflow-renderer.js";

export interface WorkflowSummary {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId?: string;
  triggerType?: string;
  startActionId?: string;
  actions: WorkflowAction[];
}

interface FlowListResponse {
  flows: Array<{
    id: string;
    name: string;
    isEnabled: boolean;
    objectTypeId?: string;
    triggerType?: string;
    startActionId?: string;
    actions?: WorkflowAction[];
  }>;
}

interface FlowDetailResponse {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId?: string;
  triggerType?: string;
  startActionId?: string;
  actions?: WorkflowAction[];
}

interface BatchReadResponse {
  results: FlowDetailResponse[];
}

export class WorkflowCache {
  private workflows: WorkflowSummary[] | null = null;
  private client: HubSpotClient;

  constructor(client: HubSpotClient) {
    this.client = client;
  }

  /** Load all workflows on first access. */
  private async ensureLoaded(): Promise<void> {
    if (this.workflows !== null) return;

    // Fetch flow list (summaries)
    const listData = await this.client.get<FlowListResponse>(
      "/automation/v4/flows",
      { limit: 500 }
    );

    const flows = listData.flows ?? [];

    // If the list endpoint already returns full details (actions), use them directly
    const needsDetail = flows.some((f) => !f.actions || f.actions.length === 0);

    if (!needsDetail || flows.length === 0) {
      this.workflows = flows.map((f) => ({
        id: f.id,
        name: f.name ?? `Workflow ${f.id}`,
        isEnabled: f.isEnabled ?? false,
        objectTypeId: f.objectTypeId,
        triggerType: f.triggerType,
        startActionId: f.startActionId,
        actions: f.actions ?? [],
      }));
      return;
    }

    // Batch-read full details in chunks of 100
    const allDetails = new Map<string, FlowDetailResponse>();
    const ids = flows.map((f) => f.id);

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const batch = await this.client.post<BatchReadResponse>(
          "/automation/v4/flows/batch/read",
          { inputs: chunk.map((id) => ({ id })) }
        );
        for (const result of batch.results ?? []) {
          allDetails.set(result.id, result);
        }
      } catch {
        // If batch read fails, fall back to using list data as-is
      }
    }

    this.workflows = flows.map((f) => {
      const detail = allDetails.get(f.id);
      return {
        id: f.id,
        name: detail?.name ?? f.name ?? `Workflow ${f.id}`,
        isEnabled: detail?.isEnabled ?? f.isEnabled ?? false,
        objectTypeId: detail?.objectTypeId ?? f.objectTypeId,
        triggerType: detail?.triggerType ?? f.triggerType,
        startActionId: detail?.startActionId ?? f.startActionId,
        actions: detail?.actions ?? f.actions ?? [],
      };
    });
  }

  /** Get all cached workflows. */
  async getAll(): Promise<WorkflowSummary[]> {
    await this.ensureLoaded();
    return this.workflows!;
  }

  /** Fuzzy search workflows by name. */
  async searchByName(query: string): Promise<WorkflowSummary[]> {
    const all = await this.getAll();
    const matches = fuzzyMatch(query, all, (w) => w.name);
    return matches.map((m) => m.item);
  }

  /** Get a single workflow by ID (from cache or direct fetch). */
  async getById(flowId: string): Promise<WorkflowSummary | null> {
    // Try cache first
    if (this.workflows) {
      const cached = this.workflows.find((w) => w.id === flowId);
      if (cached) return cached;
    }

    // Direct fetch
    try {
      const data = await this.client.get<FlowDetailResponse>(
        `/automation/v4/flows/${flowId}`
      );
      return {
        id: data.id,
        name: data.name ?? `Workflow ${data.id}`,
        isEnabled: data.isEnabled ?? false,
        objectTypeId: data.objectTypeId,
        triggerType: data.triggerType,
        startActionId: data.startActionId,
        actions: data.actions ?? [],
      };
    } catch {
      return null;
    }
  }
}
