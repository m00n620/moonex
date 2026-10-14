import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  const uri = env.mongoUri;

  if (!uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
