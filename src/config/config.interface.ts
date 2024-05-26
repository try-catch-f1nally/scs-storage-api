import {Config as DefaultConfig} from '@try-catch-f1nally/express-microservice';

export interface Config extends DefaultConfig {
  storage: {
    path: string;
  };
}

export interface EnvVars {
  PORT: number;
  MONGODB_HOST: string;
  MONGODB_PORT: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
  KAFKA_HOST: string;
  KAFKA_PORT: number;
  AUTH_PUBLIC_KEY: string;
  FRONTEND_ORIGIN: string;
}
