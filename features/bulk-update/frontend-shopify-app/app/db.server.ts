import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const url = new URL(value);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "30");

  return url.toString();
}

const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl(),
      },
    },
  });

global.prismaGlobal = prisma;

export default prisma;
