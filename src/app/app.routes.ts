import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'pr-review',
    loadComponent: () => import('./pages/pr-review/pr-review.component').then(m => m.PrReviewComponent),
  },
  {
    path: 'pr-creation',
    loadComponent: () => import('./pages/pr-creation/pr-creation.component').then(m => m.PrCreationComponent),
  },
  {
    path: 'branch-compare',
    loadComponent: () => import('./pages/branch-compare/branch-compare.component').then(m => m.BranchCompareComponent),
  },
  {
    path: 'settings/:category',
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent),
  },
  { path: 'settings', redirectTo: 'settings/bitbucket', pathMatch: 'full' },
  {
    path: 'json-viewer',
    loadComponent: () => import('./pages/json-viewer/json-viewer.component').then(m => m.JsonViewerComponent),
  },
  {
    path: 'base64-viewer',
    loadComponent: () => import('./pages/base64-viewer/base64-viewer.component').then(m => m.Base64ViewerComponent),
  },
  {
    path: 'token-gen',
    loadComponent: () => import('./pages/token-gen/token-gen.component').then(m => m.TokenGenComponent),
  },
  {
    path: 'crypto-dashboard',
    loadComponent: () => import('./pages/crypto-dashboard/crypto-dashboard.component').then(m => m.CryptoDashboardComponent),
  },
  {
    path: 'argocd-dashboard',
    loadComponent: () => import('./pages/argocd-dashboard/argocd-dashboard.component').then(m => m.ArgocdDashboardComponent),
  },
  {
    path: 'gap-analysis',
    loadComponent: () => import('./pages/gap-analysis/gap-analysis.component').then(m => m.GapAnalysisComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
