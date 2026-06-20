import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { JwtService } from "../../plugins/jwt";
import { AUTH_ERROR_MESSAGE, PASSWORD_HASH_ROUNDS, REFRESH_TOKEN_TTL_DAYS } from "./auth.constants";
import { AuthError } from "./auth.errors";
import { AuthRepository } from "./auth.repository";
import type { AuthSession, AuthTokens, PublicUser, UserWithPassword } from "./auth.types";
import { addDays, hashRefreshToken, toPublicUser } from "./auth.utils";

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
  ) {}

  async register(input: { email: string; password: string; name?: string }): Promise<AuthSession> {
    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.repository.createUser({
        email: input.email,
        passwordHash,
        name: input.name,
      });

      return this.createSession(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AuthError("Unable to register user", 409);
      }

      throw error;
    }
  }

  async login(input: { email: string; password: string }): Promise<AuthSession> {
    const user = await this.repository.findUserByEmail(input.email);

    if (!user || !user.isActive) {
      throw new AuthError(AUTH_ERROR_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw new AuthError(AUTH_ERROR_MESSAGE);
    }

    return this.createSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const payload = this.verifyRefreshToken(refreshToken);
    const tokenHash = hashRefreshToken(refreshToken);
    const existingToken = await this.repository.findRefreshTokenByHash(tokenHash);
    const now = new Date();

    if (
      !existingToken ||
      existingToken.id !== payload.tokenId ||
      existingToken.userId !== payload.sub ||
      existingToken.revokedAt ||
      existingToken.expiresAt <= now ||
      !existingToken.user.isActive
    ) {
      throw new AuthError(AUTH_ERROR_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      const repository = new AuthRepository(tx);
      await repository.revokeRefreshToken(existingToken.id);
      const tokens = await this.createTokens(existingToken.user, repository);

      return {
        user: toPublicUser(existingToken.user),
        ...tokens,
      };
    });
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = this.verifyRefreshToken(refreshToken);
      const tokenHash = hashRefreshToken(refreshToken);
      const existingToken = await this.repository.findRefreshTokenByHash(tokenHash);

      if (existingToken?.id === payload.tokenId && existingToken.userId === payload.sub) {
        await this.repository.revokeRefreshToken(existingToken.id);
      }
    } catch {
      return;
    }
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.repository.findActiveUserById(userId);

    if (!user) {
      throw new AuthError(AUTH_ERROR_MESSAGE);
    }

    return toPublicUser(user);
  }

  private verifyRefreshToken(refreshToken: string) {
    try {
      return this.jwt.verifyRefreshToken(refreshToken);
    } catch {
      throw new AuthError(AUTH_ERROR_MESSAGE);
    }
  }

  private async createSession(user: UserWithPassword): Promise<AuthSession> {
    const tokens = await this.createTokens(user, this.repository);

    return {
      user: toPublicUser(user),
      ...tokens,
    };
  }

  private async createTokens(user: UserWithPassword, repository: AuthRepository): Promise<AuthTokens> {
    const refreshTokenId = randomUUID();
    const refreshToken = this.jwt.signRefreshToken({
      sub: user.id,
      tokenId: refreshTokenId,
    });

    await repository.createRefreshToken({
      id: refreshTokenId,
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: addDays(new Date(), REFRESH_TOKEN_TTL_DAYS),
    });

    return {
      accessToken: this.jwt.signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      refreshToken,
    };
  }
}
