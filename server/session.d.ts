import 'express-session';

declare module 'express-session' {
  interface SessionData {
    tunnelService?: {
      apiKey: string;
      userSubdomain: string;
      userId: string;
      email: string;
      username: string;
      plan: 'free' | 'pro';
    };
    oauthState?: string;
  }
}
