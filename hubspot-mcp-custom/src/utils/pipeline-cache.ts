/**
 * Lazy-loading cache for HubSpot pipelines with fuzzy name-to-ID resolution.
 */

import { HubSpotClient } from "../client.js";
import { fuzzyMatch, type FuzzyMatch } from "./fuzzy.js";

export interface PipelineStage {
  id: string;
  label: string;
  displayOrder: number;
}

export interface Pipeline {
  id: string;
  label: string;
  stages: PipelineStage[];
}

interface PipelinesResponse {
  results: Array<{
    id: string;
    label: string;
    stages: Array<{
      id: string;
      label: string;
      displayOrder: number;
    }>;
  }>;
}

export interface ResolvedPipeline {
  pipelineId: string;
  pipelineLabel: string;
  confidence: number;
  stageId?: string;
  stageLabel?: string;
  stageConfidence?: number;
  /** When confidence is low, these are the alternative candidates */
  alternatives?: Array<{ label: string; id: string; score: number }>;
}

export class PipelineCache {
  private cache = new Map<string, Pipeline[]>();
  private client: HubSpotClient;

  constructor(client: HubSpotClient) {
    this.client = client;
  }

  /** Get all pipelines for an object type, fetching on first access. */
  async getPipelines(objectType: string): Promise<Pipeline[]> {
    const key = objectType.toLowerCase();
    if (!this.cache.has(key)) {
      const data = await this.client.get<PipelinesResponse>(
        `/crm/v3/pipelines/${objectType}`
      );
      this.cache.set(
        key,
        data.results.map((p) => ({
          id: p.id,
          label: p.label,
          stages: p.stages.map((s) => ({
            id: s.id,
            label: s.label,
            displayOrder: s.displayOrder,
          })),
        }))
      );
    }
    return this.cache.get(key)!;
  }

  /**
   * Resolve a pipeline (and optionally stage) by fuzzy name match.
   * Returns the best match with confidence score.
   */
  async resolvePipeline(
    objectType: string,
    pipelineName: string,
    stageName?: string
  ): Promise<ResolvedPipeline | null> {
    const pipelines = await this.getPipelines(objectType);
    const pipelineMatches = fuzzyMatch(
      pipelineName,
      pipelines,
      (p) => p.label
    );

    if (pipelineMatches.length === 0) return null;

    const best = pipelineMatches[0];
    const result: ResolvedPipeline = {
      pipelineId: best.item.id,
      pipelineLabel: best.item.label,
      confidence: best.score,
    };

    // If confidence is low, include alternatives
    if (best.score < 0.7 && pipelineMatches.length > 1) {
      result.alternatives = pipelineMatches.slice(0, 5).map((m) => ({
        label: m.item.label,
        id: m.item.id,
        score: m.score,
      }));
    }

    // Resolve stage if requested
    if (stageName) {
      const stageMatches = fuzzyMatch(
        stageName,
        best.item.stages,
        (s) => s.label
      );
      if (stageMatches.length > 0) {
        const bestStage = stageMatches[0];
        result.stageId = bestStage.item.id;
        result.stageLabel = bestStage.item.label;
        result.stageConfidence = bestStage.score;

        if (bestStage.score < 0.7 && stageMatches.length > 1) {
          result.alternatives = stageMatches.slice(0, 5).map((m) => ({
            label: m.item.label,
            id: m.item.id,
            score: m.score,
          }));
        }
      }
    }

    return result;
  }
}
