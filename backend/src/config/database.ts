import mongoose from 'mongoose';

let mongoConnected = false;

// Configurar listeners del ciclo de vida de conexión de Mongoose
mongoose.connection.on('connected', () => {
  mongoConnected = true;
});

mongoose.connection.on('disconnected', () => {
  mongoConnected = false;
});

mongoose.connection.on('error', (err) => {
  mongoConnected = false;
  console.warn(`⚠️ Error en conexión MongoDB: ${err.message}`);
});

export function getIsMongoConnected(): boolean {
  return mongoConnected && mongoose.connection.readyState === 1;
}

export async function connectDatabase(uri: string): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
    });
    mongoConnected = true;
    console.log(`✅ MongoDB conectado exitosamente en: ${uri}`);
  } catch (error: any) {
    mongoConnected = false;
    console.warn(`⚠️ No se pudo conectar a MongoDB (${error.message}).`);
    console.log('⚡ Modo Desarrollo / Fallback: Usando almacén en memoria (In-Memory Store). Todo funcionará al 100% en local.');
  }
}
