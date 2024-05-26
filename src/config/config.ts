import {processEnvValidator} from '@try-catch-f1nally/express-microservice';
import {Config, EnvVars} from './config.interface';

const envVars = processEnvValidator<EnvVars>({
  type: 'object',
  properties: {
    PORT: {type: 'integer', default: 3000},
    MONGODB_HOST: {type: 'string', format: 'hostname'},
    MONGODB_PORT: {type: 'integer', default: 27017},
    REDIS_HOST: {type: 'string', format: 'hostname'},
    REDIS_PORT: {type: 'integer', default: 6379},
    KAFKA_HOST: {type: 'string', format: 'hostname'},
    KAFKA_PORT: {type: 'integer', default: 9092},
    AUTH_PUBLIC_KEY: {type: 'string'},
    FRONTEND_ORIGIN: {type: 'string'}
  },
  required: ['MONGODB_HOST', 'AUTH_PUBLIC_KEY', 'FRONTEND_ORIGIN']
});

export const config: Config = {
  port: envVars.PORT,
  mongodb: {
    uri: `mongodb://${envVars.MONGODB_HOST}:${envVars.MONGODB_PORT}/storage-api`
  },
  redis: {
    connectionOptions: {
      host: envVars.REDIS_HOST,
      port: envVars.REDIS_PORT
    }
  },
  kafka: {
    clientOptions: {
      clientId: 'storage-api',
      brokers: [`${envVars.KAFKA_HOST}:${envVars.KAFKA_PORT}`]
    },
    consumerOptions: {
      groupId: 'storage-api-group'
    }
  },
  auth: {
    publicKey: envVars.AUTH_PUBLIC_KEY
  },
  storage: {
    path: './archives'
  },
  cors: {
    origin: envVars.FRONTEND_ORIGIN,
    credentials: true
  }
};
