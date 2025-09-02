export interface AuthStatus {
  authenticated: boolean;
  user?: User;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}

export interface AuthError {
  code: string;
  message: string;
  details?: any;
}

import { User } from './user';