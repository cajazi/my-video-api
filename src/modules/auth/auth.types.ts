import type { User, UserRole } from "@prisma/client";

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UserWithPassword = Pick<
  User,
  "id" | "email" | "passwordHash" | "name" | "role" | "isActive" | "createdAt" | "updatedAt"
>;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthSession = AuthTokens & {
  user: PublicUser;
};
