import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AnalysesService } from './analyses.service';
import { CreateGithubAnalysisDto } from './dto/create-github-analysis.dto';

@Controller('analyses')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Get()
  list() {
    return this.analyses.list();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.analyses.getSummary(id);
  }

  @Get(':id/graph')
  getGraph(@Param('id') id: string) {
    return this.analyses.getGraph(id);
  }

  @Get(':id/issues')
  getIssues(@Param('id') id: string) {
    return this.analyses.getIssues(id);
  }

  @Post('github')
  createGithub(@Body() dto: CreateGithubAnalysisDto) {
    return this.analyses.createFromGithub(dto.githubUrl, dto.name);
  }

  @Post('zip')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 80 * 1024 * 1024 },
    }),
  )
  createZip(
    @UploadedFile() file: Express.Multer.File,
    @Query('name') name?: string,
  ) {
    return this.analyses.createFromZip(file, name);
  }
}
