import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'dark' | 'light';

/** Fixed to dark so the MoltenMetal background reads correctly. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeMode>('dark');
}
