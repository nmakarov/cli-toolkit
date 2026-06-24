import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runShell } from "./run.js";

async function hasTlsCert(certPath) {
    try {
        await runShell(`sudo test -f '${certPath}'`, {});
        return true;
    } catch {
        return false;
    }
}

function proxyBlock(port) {
    return `  location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }`;
}

function buildNginxConfig(service) {
    const { nginx, pm2 } = service;
    const certDir = `/etc/letsencrypt/live/${nginx.fqdn}`;

    return `# ${nginx.siteName} — managed by cli-toolkit deploy (proxy mode)
# ${nginx.fqdn} → 127.0.0.1:${pm2.port}

server {
  listen 80;
  listen [::]:80;
  server_name ${nginx.fqdn};
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name ${nginx.fqdn};

  ssl_certificate ${certDir}/fullchain.pem;
  ssl_certificate_key ${certDir}/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  client_max_body_size 25m;

${proxyBlock(pm2.port)}
}
`;
}

function buildNginxConfigHttpOnly(service) {
    const { nginx, pm2 } = service;
    return `# ${nginx.siteName} — managed by cli-toolkit deploy (HTTP proxy, no TLS cert yet)

server {
  listen 80;
  listen [::]:80;
  server_name ${nginx.fqdn};

  client_max_body_size 25m;

${proxyBlock(pm2.port)}
}
`;
}

/** Replace the stub nginx site with a reverse-proxy to the app. */
export async function enableNginxUpstream(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const { nginx } = service;
    if (!nginx) {
        logger.info("no nginx config on service — skipping nginx step");
        return { skipped: true };
    }

    const siteAvailable = `/etc/nginx/sites-available/${nginx.siteName}`;
    const siteEnabled = `/etc/nginx/sites-enabled/${nginx.siteName}`;
    const cert = `/etc/letsencrypt/live/${nginx.fqdn}/fullchain.pem`;

    if (dryRun) {
        logger.info(`[dryRun] would write ${siteAvailable} (proxy → 127.0.0.1:${service.pm2.port}) and reload nginx`);
        return { hasCert: null };
    }

    const hasCert = await hasTlsCert(cert);
    const config = hasCert ? buildNginxConfig(service) : buildNginxConfigHttpOnly(service);

    const tmp = join(tmpdir(), `${service.name}-nginx.conf`);
    await writeFile(tmp, config);
    await runShell(
        `sudo cp '${tmp}' '${siteAvailable}' && sudo ln -sf '${siteAvailable}' '${siteEnabled}' && sudo nginx -t && sudo systemctl reload nginx`,
        { logger },
    );

    logger.info(`nginx upstream enabled for ${nginx.fqdn} → 127.0.0.1:${service.pm2.port} (tls=${hasCert})`);
    return { hasCert };
}
