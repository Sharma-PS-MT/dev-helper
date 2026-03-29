import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthConfigService } from '../services/auth-config.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authConfig = inject(AuthConfigService);
  const config = authConfig.config();

  // Bitbucket API calls
  if (req.url.includes('api.bitbucket.org') || req.url.includes(config.bitbucketBaseUrl)) {
    let proxyUrl = req.url;
    const proxyHeaders: Record<string, string> = { 'Authorization': authConfig.bitbucketAuthHeader };
    
    // In dev mode, route through local proxy to avoid CORS
    if (req.url.startsWith('http') && location.hostname === 'localhost') {
      proxyUrl = req.url.replace(config.bitbucketBaseUrl, '/bitbucket-api');
      proxyHeaders['x-proxy-target'] = config.bitbucketBaseUrl;
    }

    const cloned = req.clone({
      url: proxyUrl,
      setHeaders: proxyHeaders
    });
    return next(cloned);
  }

  // JIRA API calls
  if (config.jiraBaseUrl && req.url.includes(config.jiraBaseUrl)) {
    let proxyUrl = req.url;
    const proxyHeaders: Record<string, string> = {
      'Authorization': authConfig.jiraAuthHeader,
      'Content-Type': 'application/json',
    };

    if (req.url.startsWith('http') && location.hostname === 'localhost') {
      proxyUrl = req.url.replace(config.jiraBaseUrl, '/jira-api');
      proxyHeaders['x-proxy-target'] = config.jiraBaseUrl;
    }

    const cloned = req.clone({
      url: proxyUrl,
      setHeaders: proxyHeaders
    });
    return next(cloned);
  }

  return next(req);
};
