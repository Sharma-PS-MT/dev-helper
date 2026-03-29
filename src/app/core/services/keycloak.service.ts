import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { KeycloakEnvConfig } from './auth-config.service';

@Injectable({ providedIn: 'root' })
export class KeycloakService {
  constructor(private http: HttpClient) { }

  generateToken(config: KeycloakEnvConfig): Observable<any> {
    // Standard OpenID Connect Token endpoint
    const url = `${config.baseUrl.replace(/\/+$/, '')}/realms/${config.realm}/protocol/openid-connect/token`;

    // Keycloak requires URL Encoded forms for token grants
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', config.clientId);
    body.set('username', config.username);
    if (config.password) {
      body.set('password', config.password);
    }

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded'
    });

    return this.http.post(url, body.toString(), { headers });
  }
}
