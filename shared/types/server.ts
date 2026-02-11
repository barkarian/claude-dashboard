// === Server-specific Types ===

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  projectsBasePath: string;
  githubToken: string | null;
  sessionSecret: string;
  passwordHash: string | null;
  publicPath: string;
  tunnelMode: 'ngrok' | 'none';
}

// Augment express-session to include our custom session data
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
  }
}
