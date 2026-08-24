import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'analysis/:id',
    loadComponent: () =>
      import('./pages/analysis/analysis.page').then((m) => m.AnalysisPage),
  },
  { path: '**', redirectTo: '' },
];
