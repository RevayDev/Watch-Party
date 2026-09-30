import mongoose from 'mongoose';

export let isMongoConnected = false;

export async function connectDatabase(uri: string): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
    });
    isMongoConnected = true;
    console.log(`✅ MongoDB conectado exitosamente en: ${uri}`);
  } catch (error: any) {
    console.warn(`⚠️ No se pudo conectar a MongoDB (${error.message}).`);
    console.log('⚡ Modo Desarrollo / Fallback: Usando almacén en memoria (In-Memory Store). Todo funcionará al 100% en local.');
  }
}
