// This file configures Prisma for use in Docker/CI environments.
// DATABASE_URL is injected via environment variables — dotenv is not needed here.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
