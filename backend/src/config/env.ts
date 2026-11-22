import { z } from 'zod';

const defaultMongoUri = 'mongodb://127.0.0.1:27017/watch_party';
const startupSchema = z.object({
  PORT: z.preprocess(
    (value) => value === '' || value === undefined ? '4000' : value,
    z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(65535)),
  ),
  MONGODB_URI: z.preprocess(
    (value) => value === '' || value === undefined ? defaultMongoUri : value,
    // Mongo is optional: the repository intentionally falls back to memory
    // when the database is unavailable. A malformed Render value must not
    // turn that recoverable condition into a boot loop.
    z.string().trim().transform((value) =>
      /^mongodb(?:\+srv)?:\/\/\S+$/.test(value) ? value : defaultMongoUri
    ),
  ),
});

export function readStartupEnv(env: NodeJS.ProcessEnv) {
  const result = startupSchema.safeParse(env);
  if (!result.success) {
    const invalidKeys = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid startup configuration: ${invalidKeys.join(', ')}`);
  }
  return { port: result.data.PORT, mongoUri: result.data.MONGODB_URI };
}
