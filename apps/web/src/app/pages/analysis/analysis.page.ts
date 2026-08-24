import {
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import type {
  AnalysisSummary,
  ArchitectureGraph,
  ArchitectureIssue,
  GraphNode,
  NodeKind,
} from '@archviz/shared';
import { AnalysisApiService } from '../../core/analysis-api.service';
import { ArchitectureGraphComponent } from '../../shared/architecture-graph.component';

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ArchitectureGraphComponent,
  ],
  template: `
    <div class="mx-auto max-w-[1600px] px-4 py-6 text-white">
      @if (loading()) {
        <div class="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <mat-spinner diameter="48"></mat-spinner>
          <p class="muted">Loading analysis…</p>
        </div>
      } @else if (error()) {
        <div class="panel mx-auto max-w-xl rounded-2xl p-8 text-center">
          <mat-icon class="!text-4xl" style="color: var(--danger)">error_outline</mat-icon>
          <p class="mt-3">{{ error() }}</p>
          <a mat-button routerLink="/">Back home</a>
        </div>
      } @else if (summary() && graph()) {
        <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <a routerLink="/" class="mb-2 inline-flex items-center gap-1 text-sm muted hover:underline">
              <mat-icon class="!text-base">arrow_back</mat-icon>
              New analysis
            </a>
            <h1 class="font-display text-3xl font-semibold tracking-tight">
              {{ summary()!.name }}
            </h1>
            <p class="mt-1 text-sm muted">
              {{ summary()!.sourceUrl || summary()!.sourceType }}
              · {{ summary()!.completedAt || summary()!.createdAt | date: 'medium' }}
            </p>
          </div>

          <div class="flex items-center gap-4">
            <div
              class="score-ring grid h-20 w-20 place-items-center rounded-full p-1.5"
              [style.--score]="graph()!.healthScore"
            >
              <div
                class="grid h-full w-full place-items-center rounded-full font-display text-xl font-bold"
                style="background: var(--bg-elevated)"
              >
                {{ graph()!.healthScore }}
              </div>
            </div>
            <div>
              <div class="text-sm muted">Architecture health</div>
              <div class="font-display text-lg font-semibold">{{ healthLabel() }}</div>
            </div>
          </div>
        </div>

        <div class="grid gap-4 xl:grid-cols-[1fr_340px]">
          <section class="panel overflow-hidden rounded-2xl">
            <div
              class="flex flex-wrap items-center gap-3 border-b px-4 py-3"
              style="border-color: var(--border)"
            >
              <mat-form-field appearance="outline" class="!w-56" subscriptSizing="dynamic">
                <mat-label>Search</mat-label>
                <input matInput [(ngModel)]="searchModel" (ngModelChange)="search.set($event)" />
                <mat-icon matSuffix>search</mat-icon>
              </mat-form-field>

              <mat-form-field appearance="outline" class="!w-44" subscriptSizing="dynamic">
                <mat-label>Type</mat-label>
                <mat-select
                  [ngModel]="kindFilter()"
                  (ngModelChange)="kindFilter.set($event)"
                >
                  <mat-option value="all">All types</mat-option>
                  @for (k of kinds; track k) {
                    <mat-option [value]="k">{{ k }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-slide-toggle
                [checked]="highlightCircular()"
                (change)="highlightCircular.set($event.checked)"
              >
                Circular only
              </mat-slide-toggle>

              <button mat-stroked-button type="button" (click)="graphCmp()?.fit()">
                <mat-icon>center_focus_strong</mat-icon>
                Fit
              </button>

              <button mat-stroked-button type="button" (click)="exportPng()">
                <mat-icon>image</mat-icon>
                Export PNG
              </button>
            </div>

            <div class="h-[62vh] min-h-[420px]">
              <app-architecture-graph
                [graph]="graph()!"
                [search]="search()"
                [kindFilter]="kindFilter()"
                [highlightCircular]="highlightCircular()"
                [selectedId]="selected()?.id ?? null"
                (nodeSelected)="selected.set($event)"
              />
            </div>

            <div class="flex flex-wrap gap-2 border-t px-4 py-3" style="border-color: var(--border)">
              @for (item of legend; track item.kind) {
                <span class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
                  style="background: var(--bg-soft)">
                  <span class="h-2.5 w-2.5 rounded-full" [style.background]="item.color"></span>
                  {{ item.kind }}
                </span>
              }
            </div>
          </section>

          <aside class="space-y-4">
            <div class="panel rounded-2xl p-4">
              <h2 class="font-display font-semibold">Project stats</h2>
              <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                @for (stat of statCards(); track stat.label) {
                  <div class="rounded-xl px-3 py-2" style="background: var(--bg-soft)">
                    <div class="muted text-xs">{{ stat.label }}</div>
                    <div class="font-semibold tabular-nums">{{ stat.value }}</div>
                  </div>
                }
              </div>
            </div>

            <div class="panel rounded-2xl p-4">
              <h2 class="mb-2 font-display font-semibold">Selected node</h2>
              @if (selected(); as node) {
                <div class="space-y-2 text-sm">
                  <div class="font-mono text-xs muted break-all">{{ node.path }}</div>
                  <div class="flex flex-wrap gap-2">
                    <span class="rounded-full px-2 py-0.5 text-xs capitalize"
                      style="background: var(--accent-soft); color: var(--accent)">
                      {{ node.kind }}
                    </span>
                    <span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--bg-soft)">
                      fan-in {{ node.fanIn }}
                    </span>
                    <span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--bg-soft)">
                      fan-out {{ node.fanOut }}
                    </span>
                    <span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--bg-soft)">
                      ~{{ node.loc }} LOC
                    </span>
                  </div>
                  <div>
                    <div class="mb-1 text-xs muted">Depends on</div>
                    <ul class="max-h-28 space-y-1 overflow-auto font-mono text-xs">
                      @for (d of dependentsOf(node, 'out'); track d.id) {
                        <li>
                          <button type="button" class="hover:underline" (click)="selected.set(d)">
                            {{ d.label }}
                          </button>
                        </li>
                      } @empty {
                        <li class="muted">None</li>
                      }
                    </ul>
                  </div>
                  <div>
                    <div class="mb-1 text-xs muted">Used by</div>
                    <ul class="max-h-28 space-y-1 overflow-auto font-mono text-xs">
                      @for (d of dependentsOf(node, 'in'); track d.id) {
                        <li>
                          <button type="button" class="hover:underline" (click)="selected.set(d)">
                            {{ d.label }}
                          </button>
                        </li>
                      } @empty {
                        <li class="muted">None</li>
                      }
                    </ul>
                  </div>
                </div>
              } @else {
                <p class="text-sm muted">Click a node in the graph to inspect dependencies and metrics.</p>
              }
            </div>

            <div class="panel rounded-2xl p-4">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="font-display font-semibold">Health issues</h2>
                <span class="text-xs muted">{{ issues().length }} found</span>
              </div>
              <ul class="max-h-[42vh] space-y-3 overflow-auto pr-1 text-sm list-disc pl-5">
                @for (issue of issues(); track issue.id) {
                  <li>
                    <button
                      type="button"
                      class="text-left hover:underline"
                      (click)="focusIssue(issue)"
                    >
                      <span [ngClass]="severityClass(issue.severity)">{{ issue.severity }}</span>
                      · {{ issue.title }}
                    </button>
                    <p class="mt-0.5 text-xs muted">{{ issue.description }}</p>
                  </li>
                } @empty {
                  <li class="list-none -ml-5 text-sm muted">No issues detected.</li>
                }
              </ul>
            </div>
          </aside>
        </div>

        <section class="panel mt-4 rounded-2xl p-5">
          <h2 class="font-display text-xl font-semibold">Dependency distribution</h2>
          <p class="mb-4 text-sm muted">Share of analyzed files by architectural role</p>
          <div class="flex h-8 overflow-hidden rounded-full">
            @for (slice of distribution(); track slice.kind) {
              <div
                class="h-full"
                [style.width.%]="slice.pct"
                [style.background]="slice.color"
                [matTooltip]="slice.kind + ': ' + slice.count"
              ></div>
            }
          </div>
          <div class="mt-3 flex flex-wrap gap-3 text-xs">
            @for (slice of distribution(); track slice.kind) {
              <span class="inline-flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" [style.background]="slice.color"></span>
                {{ slice.kind }} ({{ slice.count }})
              </span>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class AnalysisPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(AnalysisApiService);

  readonly graphCmp = viewChild(ArchitectureGraphComponent);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summary = signal<AnalysisSummary | null>(null);
  readonly graph = signal<ArchitectureGraph | null>(null);
  readonly selected = signal<GraphNode | null>(null);
  readonly search = signal('');
  readonly kindFilter = signal<NodeKind | 'all'>('all');
  readonly highlightCircular = signal(false);

  searchModel = '';

  readonly kinds: NodeKind[] = [
    'component',
    'service',
    'module',
    'guard',
    'directive',
    'pipe',
    'interceptor',
    'file',
    'external',
  ];

  readonly legend = [
    { kind: 'component', color: '#0969da' },
    { kind: 'service', color: '#1a7f37' },
    { kind: 'module', color: '#8250df' },
    { kind: 'guard', color: '#9a6700' },
    { kind: 'directive', color: '#bf3989' },
    { kind: 'external', color: '#8b949e' },
  ];

  readonly issues = computed(() => this.graph()?.issues ?? []);

  readonly healthLabel = computed(() => {
    const score = this.graph()?.healthScore ?? 0;
    if (score >= 85) return 'Healthy';
    if (score >= 65) return 'Fair';
    if (score >= 40) return 'Needs attention';
    return 'Critical';
  });

  readonly statCards = computed(() => {
    const s = this.graph()?.stats;
    if (!s) return [];
    return [
      { label: 'Files', value: s.fileCount },
      { label: 'Edges', value: s.edgeCount },
      { label: 'Components', value: s.componentCount },
      { label: 'Services', value: s.serviceCount },
      { label: 'Cycles', value: s.circularCount },
      { label: 'Unused', value: s.unusedCount },
      { label: 'Avg fan-in', value: s.avgFanIn },
      { label: 'Total LOC', value: s.totalLoc },
    ];
  });

  readonly distribution = computed(() => {
    const nodes = (this.graph()?.nodes ?? []).filter((n) => !n.isExternal);
    const colors: Record<string, string> = {
      component: '#0969da',
      service: '#1a7f37',
      module: '#8250df',
      guard: '#9a6700',
      directive: '#bf3989',
      pipe: '#0550ae',
      interceptor: '#6639ba',
      file: '#656d76',
    };
    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.kind, (counts.get(n.kind) || 0) + 1);
    }
    const total = nodes.length || 1;
    return [...counts.entries()]
      .map(([kind, count]) => ({
        kind,
        count,
        pct: (count / total) * 100,
        color: colors[kind] || '#64748b',
      }))
      .sort((a, b) => b.count - a.count);
  });

  private pollTimer?: ReturnType<typeof setInterval>;

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Missing analysis id');
      this.loading.set(false);
      return;
    }
    void this.load(id);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  dependentsOf(node: GraphNode, direction: 'in' | 'out'): GraphNode[] {
    const g = this.graph();
    if (!g) return [];
    const ids =
      direction === 'out'
        ? g.edges.filter((e) => e.source === node.id).map((e) => e.target)
        : g.edges.filter((e) => e.target === node.id).map((e) => e.source);
    return ids
      .map((id) => g.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => !!n)
      .slice(0, 40);
  }

  focusIssue(issue: ArchitectureIssue) {
    const g = this.graph();
    if (!g || !issue.nodeIds.length) return;
    const node = g.nodes.find((n) => n.id === issue.nodeIds[0]) ?? null;
    this.selected.set(node);
    if (issue.type === 'circular_dependency') {
      this.highlightCircular.set(true);
    }
  }

  severityClass(severity: string): string {
    if (severity === 'critical') return 'font-medium text-rose-300';
    if (severity === 'warning') return 'font-medium text-amber-200';
    return 'font-medium text-white/80';
  }

  exportPng() {
    const host = document.querySelector('app-architecture-graph canvas') as
      | HTMLCanvasElement
      | null;
    // Cytoscape uses canvas internally; use cy.png via component fit container screenshot fallback
    const cyHost = document.querySelector('app-architecture-graph .h-full.w-full') as HTMLElement | null;
    const canvas = cyHost?.querySelector('canvas') as HTMLCanvasElement | null;
    const target = canvas || host;
    if (!target) return;
    const link = document.createElement('a');
    link.download = `${this.summary()?.name || 'archviz'}-graph.png`;
    link.href = target.toDataURL('image/png');
    link.click();
  }

  private async load(id: string) {
    try {
      let summary = await firstValueFrom(this.api.get(id));
      this.summary.set(summary);

      if (summary.status === 'pending' || summary.status === 'running') {
        await this.wait(id);
        summary = await firstValueFrom(this.api.get(id));
        this.summary.set(summary);
      }

      if (summary.status === 'failed') {
        this.error.set(summary.errorMessage || 'Analysis failed');
        return;
      }

      const graph = await firstValueFrom(this.api.graph(id));
      this.graph.set(graph);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load analysis');
    } finally {
      this.loading.set(false);
    }
  }

  private wait(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pollTimer = setInterval(() => {
        void firstValueFrom(this.api.get(id))
          .then((s) => {
            this.summary.set(s);
            if (s.status === 'completed') {
              if (this.pollTimer) clearInterval(this.pollTimer);
              resolve();
            } else if (s.status === 'failed') {
              if (this.pollTimer) clearInterval(this.pollTimer);
              reject(new Error(s.errorMessage || 'Analysis failed'));
            }
          })
          .catch((err) => {
            if (this.pollTimer) clearInterval(this.pollTimer);
            reject(err);
          });
      }, 1200);
    });
  }
}
