import mongoose from 'mongoose';

let mongoConnected = false;

// Configurar listeners del ciclo de vida de conexión de Mongoose
mongoose.connection.on('connected', () => {
  mongoConnected = true;
});

mongoose.connection.on('disconnected', () => {
  mongoConnected = false;
});

mongoose.connection.on('error', () => {
  mongoConnected = false;
  console.warn('MongoDB connection error.');
});

export function getIsMongoConnected(): boolean {
  return mongoConnected && mongoose.connection.readyState === 1;
}

/** ¿El operador pidió Prisma? `ROOM_STORE=prisma` (default `auto`). */
export function isPrismaStore(): boolean {
  return (process.env.ROOM_STORE || 'auto').trim().toLowerCase() === 'prisma';
}

let prismaConnected = false;

export function getIsPrismaConnected(): boolean {
  return prismaConnected;
}

/**
 * Conecta Prisma (solo se llama con `ROOM_STORE=prisma`). Si falla, se avisa
 * y el routing cae a memoria, igual que el fallback de Mongoose.
 */
export async function connectPrisma(): Promise<void> {
  try {
    const { getPrismaClient } = await import('../adapters/prisma-room.repository.js');
    await getPrismaClient().$connect();
    prismaConnected = true;
    console.log('✅ Prisma conectado (ROOM_STORE=prisma). Mongoose queda inactivo.');
  } catch {
    prismaConnected = false;
    console.warn('Could not connect using Prisma.');
    console.log('⚡ Fallback: usando almacén en memoria.');
  }
}

export async function connectDatabase(uri: string): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
    });
    mongoConnected = true;
    console.log('MongoDB connected.');
  } catch {
    mongoConnected = false;
    console.warn('Could not connect to MongoDB.');
    console.log('⚡ Modo Desarrollo / Fallback: Usando almacén en memoria (In-Memory Store). Todo funcionará al 100% en local.');
  }
}
