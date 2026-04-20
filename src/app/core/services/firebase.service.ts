import { Injectable, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { KeycloakEnvConfig } from './auth-config.service';
import { AppConfig, ArgocdEnvConfig } from './auth-config.service';

const firebaseConfig = {
  apiKey: "AIzaSyC3EMTK56OnUCc8hEWbrqIrDxmpwfri_A0",
  authDomain: "dev-helper-87942.firebaseapp.com",
  projectId: "dev-helper-87942",
  storageBucket: "dev-helper-87942.firebasestorage.app",
  messagingSenderId: "1020591074195",
  appId: "1:1020591074195:web:b783d199fcd8b879ca1666"
};

export type FirebaseStatus = 'connected' | 'syncing' | 'error' | 'idle';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app = initializeApp(firebaseConfig);
  private db = getFirestore(this.app);
  
  status = signal<FirebaseStatus>('connected');

  // Hardcoded path builder based on active multi-tenant user
  private getPath(username: string, domain: string) {
    if (!username || !domain) throw new Error('Cannot sync Firebase without active Session context');
    return doc(this.db, 'users', username, 'configs', domain);
  }

  async saveCredentials(config: AppConfig, username: string, domain: string): Promise<void> {
    this.status.set('syncing');
    try {
      const dbDoc = this.getPath(username, domain);
      await setDoc(dbDoc, config);
      this.status.set('connected');
    } catch (e) {
      console.error('Firebase sync failed', e);
      this.status.set('error');
    }
  }

  // =========================================================================
  // GLOBAL KEYCLOAK ENVS — shared across all users (global/keycloak doc)
  // =========================================================================

  private get globalKeycloakDoc() {
    return doc(this.db, 'global', 'keycloak');
  }

  async saveGlobalKeycloakEnvs(envs: KeycloakEnvConfig[]): Promise<void> {
    this.status.set('syncing');
    try {
      await setDoc(this.globalKeycloakDoc, { keycloakEnvs: envs }, { merge: true });
      this.status.set('connected');
    } catch (e) {
      console.error('Firebase global keycloak save failed', e);
      this.status.set('error');
    }
  }

  async loadGlobalKeycloakEnvs(): Promise<KeycloakEnvConfig[]> {
    try {
      const snap = await getDoc(this.globalKeycloakDoc);
      if (snap.exists()) {
        const data = snap.data();
        this.status.set('connected');
        return (data['keycloakEnvs'] as KeycloakEnvConfig[]) || [];
      }
      return [];
    } catch (e) {
      console.error('Firebase global keycloak load failed', e);
      this.status.set('error');
      return [];
    }
  }

  // =========================================================================
  // GLOBAL ARGOCD ENVS — shared across all users (global/argocd doc)
  // =========================================================================

  private get globalArgocdDoc() {
    return doc(this.db, 'global', 'argocd');
  }

  async saveGlobalArgocdEnvs(envs: ArgocdEnvConfig[]): Promise<void> {
    this.status.set('syncing');
    try {
      await setDoc(this.globalArgocdDoc, { argocdEnvs: envs }, { merge: true });
      this.status.set('connected');
    } catch (e) {
      console.error('Firebase global argocd save failed', e);
      this.status.set('error');
    }
  }

  async loadGlobalArgocdEnvs(): Promise<ArgocdEnvConfig[]> {
    try {
      const snap = await getDoc(this.globalArgocdDoc);
      if (snap.exists()) {
        const data = snap.data();
        this.status.set('connected');
        return (data['argocdEnvs'] as ArgocdEnvConfig[]) || [];
      }
      return [];
    } catch (e) {
      console.error('Firebase global argocd load failed', e);
      this.status.set('error');
      return [];
    }
  }

  async loadCredentials(username: string, domain: string): Promise<Partial<AppConfig> | null> {
    try {
      const snap = await getDoc(this.getPath(username, domain));
      if (snap.exists()) {
        const data = snap.data();
        this.status.set('connected');
        return data as Partial<AppConfig>;
      }
      return null;
    } catch (e) {
      console.error('Firebase load failed', e);
      this.status.set('error');
      return null;
    }
  }
}
