import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const publicUserSelect = {
  id: true,
  email: true,
  passwordHash: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export class AuthRepository {
  constructor(private readonly prisma: PrismaExecutor) {}

  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: publicUserSelect,
    });
  }

  findActiveUserById(id: string) {
    return this.prisma.user.findFirst({
      where: {
        id,
        isActive: true,
      },
      select: publicUserSelect,
    });
  }

  createUser(input: { email: string; passwordHash: string; name?: string }) {
    return this.prisma.user.create({
      data: input,
      select: publicUserSelect,
    });
  }

  createRefreshToken(input: { id: string; userId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.refreshToken.create({
      data: input,
    });
  }

  findRefreshTokenByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: publicUserSelect,
        },
      },
    });
  }

  revokeRefreshToken(id: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
