// === Server-specific Types ===

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  githubToken: string | null;
  sessionSecret: string;
  tunnelApiKey: string | null;
  tunnelUserSubdomain: string | null;
  publicPath: string;
  tunnelMode: 'ngrok' | 'tunnel-service' | 'none';
  tunnelServiceUrl: string | null;
  tunnelDomain: string | null;
  isVps: boolean;
  vpsIp: string | null;
  sshUser: string;
  sshPort: number;
  migrationSourceUrl: string | null;
  dashboardEnv: 'local' | 'vps';
}
