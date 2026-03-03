import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { ServerConfig } from '../shared/types/server.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const config: ServerConfig = {
  port: 2222,
  nodeEnv: process.env.NODE_ENV || 'development',
  githubToken: process.env.GITHUB_TOKEN || null,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  tunnelApiKey: process.env.TUNNEL_API_KEY || null,
  tunnelUserSubdomain: process.env.TUNNEL_USER_SUBDOMAIN || null,
  publicPath: path.join(__dirname, 'public'),
  tunnelMode: (['ngrok', 'tunnel-service'].includes(process.env.TUNNEL_MODE || '')
    ? process.env.TUNNEL_MODE as 'ngrok' | 'tunnel-service'
    : 'none') as 'ngrok' | 'tunnel-service' | 'none',
  tunnelServiceUrl: process.env.TUNNEL_SERVICE_URL || null,
  tunnelDomain: process.env.TUNNEL_DOMAIN || null,
  isVps: process.env.IS_VPS === 'true',
  vpsIp: process.env.VPS_IP || null,
  sshUser: process.env.SSH_USER || 'claw-user',
  sshPort: parseInt(process.env.SSH_PORT || '22', 10),
  migrationSourceUrl: process.env.MIGRATION_SOURCE_URL || null,
  dashboardEnv: (process.env.DASHBOARD_ENV === 'vps' ? 'vps' : 'local') as 'local' | 'vps',
};

export default config;
