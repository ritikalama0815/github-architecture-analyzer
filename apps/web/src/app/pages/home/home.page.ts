import { Component, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { AnalysisSummary } from '@archviz/shared';
import { AnalysisApiService } from '../../core/analysis-api.service';
import { SpecularButtonComponent } from '../../shared/specular-button/specular-button.component';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    SpecularButtonComponent,
  ],
  template: `
    <div class="mx-auto max-w-6xl px-4 py-10 md:py-14 text-white">
      <section class="max-w-2xl">
        <h1 class="text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-white">
          Github architecture analyzer
        </h1>
        <p class="mt-3 text-base text-white/80 leading-relaxed">
          Paste a public GitHub URL or upload a project ZIP. You’ll get an import graph
          plus notes on cycles, coupling, and unused files.
        </p>
      </section>

      <section class="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div>
          <h2 class="text-sm font-medium text-white/80 mb-3">GitHub repository</h2>
          <mat-form-field appearance="outline">
            <mat-label>Repository URL</mat-label>
            <input
              matInput
              [(ngModel)]="githubUrl"
              placeholder="Paste github repo link"
              [disabled]="busy()"
            />
          </mat-form-field>
          <div class="mt-1">
            <app-specular-button
              label="Analyze repository"
              size="md"
              [radius]="12"
              tint="#ffffff"
              [tintOpacity]="0.12"
              [blur]="8"
              textColor="#ffffff"
              lineColor="#ffffff"
              baseColor="#a78bfa"
              [intensity]="1"
              [shineSize]="10"
              [shineFade]="40"
              [thickness]="1"
              [speed]="0.35"
              [followMouse]="true"
              [proximity]="250"
              [autoAnimate]="false"
              [disabled]="busy() || !githubUrl.trim()"
              (clicked)="submitGithub()"
            />
          </div>
        </div>

        <div
          class="rounded-lg border border-dashed p-5 transition"
          style="border-color: var(--border); background: var(--bg-elevated)"
          [class.ring-1]="dragging()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
        >
          <h2 class="text-sm font-medium text-white/80 mb-2">ZIP upload</h2>
          <p class="mb-4 text-sm text-white/80">
            Drop a project ZIP here, or choose a file. Max ~80MB. \`node_modules\` is ignored during scan.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="fileInput.click()">
              Choose ZIP
            </button>
            @if (selectedFile()) {
              <span class="text-sm font-mono">{{ selectedFile()!.name }}</span>
              <button
                mat-flat-button
                type="button"
                class="!bg-[var(--accent)]"
                [disabled]="busy()"
                (click)="submitZip()"
              >
                Analyze ZIP
              </button>
            }
          </div>
          <input
            #fileInput
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            (change)="onFilePicked($event)"
          />
        </div>
      </section>

      @if (busy()) {
        <div class="mt-8 max-w-xl">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p class="mt-2 text-sm text-white/80">{{ statusText() }}</p>
        </div>
      }

      <section class="mt-14">
        <div class="mb-4 flex items-end justify-between gap-4 border-b pb-3" style="border-color: var(--border)">
          <div>
            <h2 class="text-lg font-semibold text-white">Recent analyses</h2>
            <p class="text-sm text-white/80">
              Kept in memory for this session unless PostgreSQL is running.
            </p>
          </div>
          <button mat-button type="button" (click)="refreshRecent()" [disabled]="busy()">
            Refresh
          </button>
        </div>

        <ul class="divide-y" style="border-color: var(--border)">
          @for (item of recent(); track item.id) {
            <li class="py-3" style="border-color: var(--border)">
              <a
                [routerLink]="['/analysis', item.id]"
                class="flex flex-wrap items-center justify-between gap-3 hover:opacity-80 text-white"
              >
                <div class="min-w-0">
                  <div class="font-medium truncate text-white">{{ item.name }}</div>
                  <div class="mt-0.5 text-xs text-white/75 font-mono truncate max-w-[420px]">
                    {{ item.sourceUrl || item.sourceType }}
                  </div>
                </div>
                <div class="flex items-center gap-3 text-sm shrink-0 text-white/80">
                  <span class="capitalize">{{ item.status }}</span>
                  @if (item.healthScore != null) {
                    <span class="tabular-nums text-white">{{ item.healthScore }}</span>
                  }
                  <span class="text-xs text-white/70">{{ item.createdAt | date: 'short' }}</span>
                </div>
              </a>
            </li>
          } @empty {
            <li class="py-8 text-sm text-white/80">No analyses yet. Start with a GitHub URL or ZIP upload.</li>
          }
        </ul>
      </section>
    </div>
  `,
})
export class HomePage implements OnDestroy {
  private readonly api = inject(AnalysisApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  githubUrl = '';
  readonly busy = signal(false);
  readonly dragging = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly statusText = signal('Working…');
  readonly recent = signal<AnalysisSummary[]>([]);

  private pollTimer?: ReturnType<typeof setInterval>;

  constructor() {
    void this.refreshRecent();
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async refreshRecent() {
    try {
      const list = await firstValueFrom(this.api.list());
      this.recent.set(list);
    } catch {
      // API may not be up yet
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.selectedFile.set(file);
  }

  onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
  }

  async submitGithub() {
    await this.startAnalysis(() =>
      firstValueFrom(this.api.fromGithub(this.githubUrl.trim())),
    );
  }

  async submitZip() {
    const file = this.selectedFile();
    if (!file) return;
    await this.startAnalysis(() => firstValueFrom(this.api.fromZip(file)));
  }

  private async startAnalysis(create: () => Promise<AnalysisSummary>) {
    this.busy.set(true);
    this.statusText.set('Creating analysis…');
    try {
      const summary = await create();
      this.statusText.set('Scanning source and building graph…');
      await this.waitUntilDone(summary.id);
      await this.refreshRecent();
      await this.router.navigate(['/analysis', summary.id]);
    } catch (error) {
      let message = 'Failed to start analysis. Is the API running on :3000?';
      if (error instanceof HttpErrorResponse) {
        message =
          (typeof error.error === 'object' && error.error?.message) ||
          error.message ||
          message;
      } else if (error instanceof Error) {
        message = error.message;
      }
      this.snack.open(String(message), 'Dismiss', { duration: 5000 });
    } finally {
      this.busy.set(false);
      if (this.pollTimer) clearInterval(this.pollTimer);
    }
  }

  private waitUntilDone(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const summary = await firstValueFrom(this.api.get(id));
          if (summary.status === 'completed') {
            resolve();
            return true;
          }
          if (summary.status === 'failed') {
            reject(new Error(summary.errorMessage || 'Analysis failed'));
            return true;
          }
          this.statusText.set(`Status: ${summary.status}…`);
          return false;
        } catch (e) {
          reject(e);
          return true;
        }
      };

      void tick().then((done) => {
        if (done) return;
        this.pollTimer = setInterval(() => {
          void tick().then((doneNow) => {
            if (doneNow && this.pollTimer) clearInterval(this.pollTimer);
          });
        }, 1200);
      });
    });
  }
}
