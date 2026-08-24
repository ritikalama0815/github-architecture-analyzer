import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import type {
  AnalysisSummary,
  ArchitectureGraph,
} from '../types';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { IngestService } from '../ingest/ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalysisRecord,
  MemoryStoreService,
} from './memory-store.service';

@Injectable()
export class AnalysesService {
  private readonly logger = new Logger(AnalysesService.name);
  private dbAvailable = false;

  constructor(
    private readonly store: MemoryStoreService,
    private readonly ingest: IngestService,
    private readonly analyzer: AnalyzerService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    setTimeout(() => void this.probeDb(), 500);
  }

  private async probeDb() {
    try {
      if (!this.prisma.connected) {
        this.dbAvailable = false;
        this.logger.warn(
          'PostgreSQL unavailable — using in-memory store (start docker compose for persistence)',
        );
        return;
      }
      await this.prisma.$queryRaw`SELECT 1`;
      this.dbAvailable = true;
      this.logger.log('PostgreSQL connected — analyses will be persisted');
    } catch {
      this.dbAvailable = false;
      this.logger.warn(
        'PostgreSQL unavailable — using in-memory store (start docker compose for persistence)',
      );
    }
  }

  async list(): Promise<AnalysisSummary[]> {
    if (this.dbAvailable) {
      try {
        const rows = await this.prisma.analysis.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        return rows.map((r) => this.toSummaryFromDb(r));
      } catch {
        this.dbAvailable = false;
      }
    }
    return this.store.list().map((r) => this.toSummary(r));
  }

  async getSummary(id: string): Promise<AnalysisSummary> {
    const record = await this.getRecord(id);
    return this.toSummary(record);
  }

  async getGraph(id: string): Promise<ArchitectureGraph> {
    const record = await this.getRecord(id);
    if (record.status !== 'completed' || !record.graph) {
      throw new BadRequestException('Analysis is not completed yet');
    }
    return record.graph;
  }

  async getIssues(id: string) {
    const graph = await this.getGraph(id);
    return {
      healthScore: graph.healthScore,
      stats: graph.stats,
      issues: graph.issues,
    };
  }

  async createFromGithub(githubUrl: string, name?: string) {
    const parsed = this.ingest.parseGithubUrl(githubUrl);
    if (!parsed) {
      throw new BadRequestException(
        'Invalid GitHub URL. Expected https://github.com/owner/repo',
      );
    }

    const id = uuidv4();
    const analysisName = name || `${parsed.owner}/${parsed.repo}`;
    const record = this.store.create({
      id,
      name: analysisName,
      sourceType: 'github',
      sourceUrl: githubUrl,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await this.persistCreate(record);
    void this.runAnalysis(id, async (workDir) => {
      await this.ingest.downloadGithubRepo(parsed.owner, parsed.repo, workDir);
    });
    return this.toSummary(record);
  }

  async createFromZip(file: Express.Multer.File, name?: string) {
    if (!file) {
      throw new BadRequestException('ZIP file is required');
    }
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Only .zip uploads are supported');
    }

    const id = uuidv4();
    const analysisName = name || file.originalname.replace(/\.zip$/i, '');
    const record = this.store.create({
      id,
      name: analysisName,
      sourceType: 'zip',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await this.persistCreate(record);
    void this.runAnalysis(id, async (workDir) => {
      await this.ingest.extractZip(file.buffer, workDir);
    });
    return this.toSummary(record);
  }

  private async runAnalysis(
    id: string,
    prepare: (workDir: string) => Promise<void>,
  ) {
    const uploadRoot =
      this.config.get<string>('UPLOAD_DIR') ||
      join(process.cwd(), 'uploads');
    const workDir = join(uploadRoot, id);

    try {
      this.patch(id, { status: 'running', workDir });
      await prepare(workDir);
      const projectRoot = this.ingest.findProjectRoot(workDir);
      const graph = await this.analyzer.analyze(projectRoot);
      this.patch(id, {
        status: 'completed',
        healthScore: graph.healthScore,
        stats: graph.stats,
        graph,
        issues: graph.issues,
        completedAt: new Date().toISOString(),
        errorMessage: null,
      });
      await this.persistComplete(id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown analysis failure';
      this.logger.error(`Analysis ${id} failed: ${message}`);
      this.patch(id, {
        status: 'failed',
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
      await this.persistComplete(id);
    }
  }

  private patch(id: string, patch: Partial<AnalysisRecord>) {
    this.store.update(id, patch);
  }

  private async getRecord(id: string): Promise<AnalysisRecord> {
    const memory = this.store.get(id);
    if (memory) return memory;

    if (this.dbAvailable) {
      try {
        const row = await this.prisma.analysis.findUnique({ where: { id } });
        if (row) {
          const record = this.fromDb(row);
          this.store.create(record);
          return record;
        }
      } catch {
        this.dbAvailable = false;
      }
    }

    throw new NotFoundException(`Analysis ${id} not found`);
  }

  private async persistCreate(record: AnalysisRecord) {
    if (!this.dbAvailable) return;
    try {
      await this.prisma.analysis.create({
        data: {
          id: record.id,
          name: record.name,
          sourceType: record.sourceType,
          sourceUrl: record.sourceUrl ?? null,
          status: record.status,
          createdAt: new Date(record.createdAt),
        },
      });
    } catch (error) {
      this.logger.warn(`DB create failed: ${(error as Error).message}`);
      this.dbAvailable = false;
    }
  }

  private async persistComplete(id: string) {
    if (!this.dbAvailable) return;
    const record = this.store.get(id);
    if (!record) return;
    try {
      await this.prisma.analysis.update({
        where: { id },
        data: {
          status: record.status,
          healthScore: record.healthScore ?? null,
          errorMessage: record.errorMessage ?? null,
          completedAt: record.completedAt
            ? new Date(record.completedAt)
            : null,
          workDir: record.workDir ?? null,
          statsJson: (record.stats ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          graphJson: (record.graph ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          issuesJson: (record.issues ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(`DB update failed: ${(error as Error).message}`);
      this.dbAvailable = false;
    }
  }

  private toSummary(record: AnalysisRecord): AnalysisSummary {
    return {
      id: record.id,
      name: record.name,
      sourceType: record.sourceType,
      sourceUrl: record.sourceUrl,
      status: record.status,
      healthScore: record.healthScore,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      stats: record.stats,
    };
  }

  private toSummaryFromDb(row: {
    id: string;
    name: string;
    sourceType: string;
    sourceUrl: string | null;
    status: string;
    healthScore: number | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    statsJson: unknown;
  }): AnalysisSummary {
    return {
      id: row.id,
      name: row.name,
      sourceType: row.sourceType as 'zip' | 'github',
      sourceUrl: row.sourceUrl,
      status: row.status as AnalysisSummary['status'],
      healthScore: row.healthScore,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      stats: (row.statsJson as AnalysisSummary['stats']) ?? null,
    };
  }

  private fromDb(row: {
    id: string;
    name: string;
    sourceType: string;
    sourceUrl: string | null;
    status: string;
    healthScore: number | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    workDir: string | null;
    statsJson: unknown;
    graphJson: unknown;
    issuesJson: unknown;
  }): AnalysisRecord {
    return {
      id: row.id,
      name: row.name,
      sourceType: row.sourceType as 'zip' | 'github',
      sourceUrl: row.sourceUrl,
      status: row.status as AnalysisRecord['status'],
      healthScore: row.healthScore,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      workDir: row.workDir,
      stats: (row.statsJson as AnalysisRecord['stats']) ?? null,
      graph: (row.graphJson as ArchitectureGraph) ?? null,
      issues: (row.issuesJson as AnalysisRecord['issues']) ?? null,
    };
  }
}
