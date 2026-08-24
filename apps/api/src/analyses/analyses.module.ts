import { Module } from '@nestjs/common';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { IngestService } from '../ingest/ingest.service';
import { MemoryStoreService } from './memory-store.service';

@Module({
  controllers: [AnalysesController],
  providers: [
    AnalysesService,
    AnalyzerService,
    IngestService,
    MemoryStoreService,
  ],
})
export class AnalysesModule {}
