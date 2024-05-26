import {
  Application,
  AuthMiddleware,
  Kafka,
  Log4jsService,
  MongoDb,
  Redis
} from '@try-catch-f1nally/express-microservice';
import {config} from './config/config';
import {StorageServiceImpl} from './storage/storage.service';
import {StorageController} from './storage/storage.controller';
import {ArchiveModelImpl} from './storage/archive.model';

const log4jsService = new Log4jsService(config);
const authMiddleware = new AuthMiddleware(config);
const mongoDb = new MongoDb(config, log4jsService.getLogger('MongoDB'));
const redis = new Redis(config, log4jsService.getLogger('Redis'));
const kafka = new Kafka(config, log4jsService.getLogger('Kafka'));
const storageService = new StorageServiceImpl(
  log4jsService.getLogger('StorageService'),
  config,
  ArchiveModelImpl,
  redis.client,
  kafka.producer,
  kafka.consumer
);
const storageController = new StorageController(storageService, authMiddleware);

void new Application({
  controllers: [storageController],
  logger: log4jsService.getLogger('Application'),
  connectableServices: [mongoDb, kafka, redis],
  startableServices: [storageService],
  config
}).start();
