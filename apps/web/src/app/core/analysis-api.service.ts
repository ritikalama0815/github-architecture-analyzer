import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  AnalysisSummary,
  ArchitectureGraph,
  ArchitectureIssue,
  ProjectStats,
} from '@archviz/shared';

export interface IssuesResponse {
  healthScore: number;
  stats: ProjectStats;
  issues: ArchitectureIssue[];
}

@Injectable({ providedIn: 'root' })
export class AnalysisApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/analyses';

  list(): Observable<AnalysisSummary[]> {
    return this.http.get<AnalysisSummary[]>(this.base);
  }

  get(id: string): Observable<AnalysisSummary> {
    return this.http.get<AnalysisSummary>(`${this.base}/${id}`);
  }

  graph(id: string): Observable<ArchitectureGraph> {
    return this.http.get<ArchitectureGraph>(`${this.base}/${id}/graph`);
  }

  issues(id: string): Observable<IssuesResponse> {
    return this.http.get<IssuesResponse>(`${this.base}/${id}/issues`);
  }

  fromGithub(githubUrl: string, name?: string): Observable<AnalysisSummary> {
    return this.http.post<AnalysisSummary>(`${this.base}/github`, {
      githubUrl,
      name,
    });
  }

  fromZip(file: File, name?: string): Observable<AnalysisSummary> {
    const form = new FormData();
    form.append('file', file);
    const q = name ? `?name=${encodeURIComponent(name)}` : '';
    return this.http.post<AnalysisSummary>(`${this.base}/zip${q}`, form);
  }
}
