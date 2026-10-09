import { defineConfig } from 'prisma/config';

// Prisma 7: la URL vive aquí (ya no en schema.prisma).
// Prioridad: DATABASE_URL > MONGODB_URI (la misma de Mongoose) > local.
const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/watch_party';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
