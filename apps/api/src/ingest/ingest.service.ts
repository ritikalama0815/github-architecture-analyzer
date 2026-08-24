import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly config: ConfigService) {}

  parseGithubUrl(
    url: string,
  ): { owner: string; repo: string } | null {
    try {
      const parsed = new URL(url.trim());
      if (!['github.com', 'www.github.com'].includes(parsed.hostname)) {
        return null;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      return {
        owner: parts[0],
        repo: parts[1].replace(/\.git$/i, ''),
      };
    } catch {
      return null;
    }
  }

  async downloadGithubRepo(
    owner: string,
    repo: string,
    workDir: string,
  ): Promise<void> {
    mkdirSync(workDir, { recursive: true });
    const token = this.config.get<string>('GITHUB_TOKEN');
    const zipballUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;
    this.logger.log(`Downloading ${owner}/${repo}...`);

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'archviz-analyzer',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(zipballUrl, {
      headers,
      redirect: 'follow',
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub download failed (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const zipPath = join(workDir, 'repo.zip');
    writeFileSync(zipPath, buffer);
    await this.extractZip(buffer, workDir);
  }

  async extractZip(buffer: Buffer, workDir: string): Promise<void> {
    mkdirSync(workDir, { recursive: true });
    const zip = new AdmZip(buffer);
    zip.extractAllTo(workDir, true);
  }

  findProjectRoot(workDir: string): string {
    const entries = readdirSync(workDir);
    const skip = new Set(['__MACOSX', '.DS_Store', 'repo.zip']);
    const dirs = entries
      .filter((e) => !skip.has(e))
      .map((e) => join(workDir, e))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });

    // GitHub zipball extracts into a single owner-repo-sha folder
    if (dirs.length === 1 && this.looksLikeProject(dirs[0])) {
      return dirs[0];
    }
    if (this.looksLikeProject(workDir)) {
      return workDir;
    }
    if (dirs.length === 1) {
      return dirs[0];
    }
    return workDir;
  }

  private looksLikeProject(dir: string): boolean {
    return (
      existsSync(join(dir, 'package.json')) ||
      existsSync(join(dir, 'tsconfig.json')) ||
      existsSync(join(dir, 'angular.json')) ||
      existsSync(join(dir, 'src'))
    );
  }
}
