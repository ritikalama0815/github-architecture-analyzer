import { Injectable } from '@nestjs/common';
import type {
  AnalysisStatus,
  ArchitectureGraph,
  ArchitectureIssue,
  ProjectStats,
} from '../types';

export interface AnalysisRecord {
  id: string;
  name: string;
  sourceType: 'zip' | 'github';
  sourceUrl?: string | null;
  status: AnalysisStatus;
  healthScore?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  workDir?: string | null;
  stats?: ProjectStats | null;
  graph?: ArchitectureGraph | null;
  issues?: ArchitectureIssue[] | null;
}

@Injectable()
export class MemoryStoreService {
  private readonly analyses = new Map<string, AnalysisRecord>();

  create(record: AnalysisRecord): AnalysisRecord {
    this.analyses.set(record.id, record);
    return record;
  }

  update(id: string, patch: Partial<AnalysisRecord>): AnalysisRecord | null {
    const existing = this.analyses.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.analyses.set(id, next);
    return next;
  }

  get(id: string): AnalysisRecord | null {
    return this.analyses.get(id) ?? null;
  }

  list(): AnalysisRecord[] {
    return [...this.analyses.values()].sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    );
  }
}
