import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(private snackBar: MatSnackBar) { }

  private show(message: string, panelClass: string, duration = 4000): void {
    const config: MatSnackBarConfig = {
      duration,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: [panelClass],
    };
    this.snackBar.open(message, '✕', config);
  }

  success(message: string): void { this.show(message, 'snack-success'); }
  error(message: string, duration = 6000): void { this.show(message, 'snack-error', duration); }
  info(message: string): void { this.show(message, 'snack-info'); }
  warn(message: string): void { this.show(message, 'snack-warn'); }
}
