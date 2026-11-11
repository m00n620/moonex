import dotenv from 'dotenv';

const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';

dotenv.config({ path: `.env.${mode}`, quiet: true });

export function getEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export const env = {
  mode,
  mongoUri: getEnv('MONGODB_URI'),
};
