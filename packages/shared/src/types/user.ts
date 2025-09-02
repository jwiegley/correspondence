export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  googleId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSession extends User {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
}