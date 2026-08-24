import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { MoltenMetalComponent } from './shared/molten-metal/molten-metal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MoltenMetalComponent],
  template: `
    <div class="relative min-h-screen flex flex-col">
      <div
        class="pointer-events-none fixed inset-0 -z-10"
        style="background: #05020f"
        aria-hidden="true"
      >
        <app-molten-metal
          color1="#5227FF"
          color2="#FF9FFC"
          color3="#FFFFFF"
          [speed]="0.35"
          [scale]="4"
          [detail]="3"
          [glow]="1.6"
          [coreSize]="0.1"
          [swirl]="1"
          [fold]="-0.2"
          [blackPoint]="0.05"
          [brightness]="1.3"
          colorMode="molten"
          [grain]="true"
          [grainIntensity]="0.05"
          [mouseInteraction]="true"
          [mouseStrength]="0.3"
          [opacity]="1"
        />
      </div>

      <header
        class="relative z-10 border-b backdrop-blur-md"
        style="border-color: var(--border); background: rgba(5, 2, 15, 0.45)"
      >
        <div class="mx-auto flex max-w-6xl items-center px-4 py-3">
          <a routerLink="/" class="min-w-0">
            <div class="text-[15px] font-semibold tracking-tight truncate text-white">
              Github architecture analyzer
            </div>
          </a>
        </div>
      </header>

      <main class="relative z-10 flex-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AppComponent {}
