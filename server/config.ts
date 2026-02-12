import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { ServerConfig } from '../shared/types/server.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const config: ServerConfig = {
  port: 2222,
  nodeEnv: process.env.NODE_ENV || 'development',
  projectsBasePath: process.env.PROJECTS_PATH || path.join(os.homedir(), 'claude-projects'),
  githubToken: process.env.GITHUB_TOKEN || null,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  passwordHash: process.env.DASHBOARD_PASSWORD_HASH || null,
  publicPath: path.join(__dirname, 'public'),
  tunnelMode: (['ngrok', 'tunnel-service'].includes(process.env.TUNNEL_MODE || '')
    ? process.env.TUNNEL_MODE as 'ngrok' | 'tunnel-service'
    : 'none') as 'ngrok' | 'tunnel-service' | 'none',
  tunnelServiceUrl: process.env.TUNNEL_SERVICE_URL || null,
  tunnelDomain: process.env.TUNNEL_DOMAIN || null,
};

export default config;
