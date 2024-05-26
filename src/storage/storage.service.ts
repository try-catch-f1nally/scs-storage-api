import fs from 'node:fs';
import path from 'node:path';
import {
  BadRequestError,
  KafkaConsumer,
  KafkaProducer,
  Logger,
  RedisClient,
  Startable
} from '@try-catch-f1nally/express-microservice';
import {Config} from '../config/config.interface';
import {Archive, ArchiveModel} from './archive.model.interface';
import {StorageService} from './storage.service.interface';

const UPLOAD_STREAM_TOPIC = 'upload-stream';
const UPLOAD_ACKNOWLEDGE_TOPIC = 'upload-acknowledge';
const DOWNLOAD_TOPIC = 'download-stream';

type BaseUploadMessageValue = {userId: string; archiveName: string};
type UploadStartMessage = {key: 'start'; value: BaseUploadMessageValue};
type UploadDataMessage = {key: 'data'; value: BaseUploadMessageValue & {data: string; orderNumber: number}};
type UploadFinishMessage = {
  key: 'finish';
  value: BaseUploadMessageValue & {chunkAmount: number; checksum: string; iv: string};
};
type UploadAbortMessage = {key: 'abort'; value: BaseUploadMessageValue};

export class StorageServiceImpl implements StorageService, Startable {
  private readonly _logger: Logger;
  private readonly _config: Config;
  private readonly _archiveModel: ArchiveModel;
  private readonly _redisClient: RedisClient;
  private readonly _kafkaProducer: KafkaProducer;
  private readonly _kafkaConsumer: KafkaConsumer;

  constructor(
    logger: Logger,
    config: Config,
    archiveModel: ArchiveModel,
    redisClient: RedisClient,
    kafkaProducer: KafkaProducer,
    kafkaConsumer: KafkaConsumer
  ) {
    this._logger = logger;
    this._config = config;
    this._archiveModel = archiveModel;
    this._redisClient = redisClient;
    this._kafkaProducer = kafkaProducer;
    this._kafkaConsumer = kafkaConsumer;
  }

  start() {
    return this._subscribeOnUploadStreamTopic();
  }

  stop() {
    return this._kafkaConsumer.stop();
  }

  getUserArchives(userId: string) {
    return this._archiveModel.find({userId});
  }

  async deleteArchive(userId: string, archiveName: string) {
    const archive = await this._archiveModel.findOneAndDelete({userId, name: archiveName});
    if (!archive) {
      throw new BadRequestError(`No archive with name "${archiveName}" found`);
    }
    const {filePath} = this._getArchivePath(archive.userId, archive.name);
    await fs.promises.rm(filePath, {recursive: true, force: true});
  }

  async initiateDownload(userId: string, archiveName: string) {
    const archive = await this._archiveModel.findOne({userId, name: archiveName});
    if (!archive) {
      throw new BadRequestError(`No archive with name "${archiveName}" found`);
    }
    this._sendArchive(archive).catch((err) => this._logger.error(`Error on sending archive "${archiveName}"`, err));
  }

  async _sendArchive(archive: Archive) {
    const {userId, name: archiveName, checksum} = archive;
    await this._kafkaProducer.send({
      topic: DOWNLOAD_TOPIC,
      messages: [{key: 'start', value: JSON.stringify({userId, archiveName, checksum})}]
    });
    for await (const chunk of fs.createReadStream(this._getArchivePath(userId, archiveName).filePath)) {
      const data = (chunk as Buffer).toString('base64');
      await this._kafkaProducer.send({
        topic: DOWNLOAD_TOPIC,
        messages: [{key: 'data', value: JSON.stringify({userId, archiveName, data})}]
      });
    }
    await this._kafkaProducer.send({
      topic: DOWNLOAD_TOPIC,
      messages: [{key: 'finish', value: JSON.stringify({userId, archiveName})}]
    });
  }

  async _subscribeOnUploadStreamTopic() {
    await this._kafkaConsumer.subscribe({topic: UPLOAD_STREAM_TOPIC});
    await this._kafkaConsumer.run({
      eachMessage: async (payload) => {
        const message = {
          key: payload.message.key!.toString(),
          value: payload.message.value!.toString()
        } as unknown as UploadStartMessage | UploadDataMessage | UploadFinishMessage | UploadAbortMessage;
        if (message.key === 'start') {
          await this._handleUploadStart(message.value);
        } else if (message.key === 'data') {
          await this._handleUploadData(message.value);
        } else if (message.key === 'finish') {
          await this._handleUploadFinish(message.value);
        } else if (message.key === 'abort') {
          await this._handleUploadAbort(message.value);
        }
      }
    });
  }

  async _handleUploadStart({userId, archiveName}: UploadStartMessage['value']) {
    await this._redisClient.set(this._getProcessedChunksRedisKey(userId, archiveName), 0);
    await fs.promises.mkdir(this._getArchivePath(userId, archiveName).dirPath, {recursive: true});
    await this._archiveModel.create({userId, name: archiveName});
    await this._sendUploadAcknowledgeMessage('start', {userId, archiveName, status: 'success'});
    this._logger.debug(`Ready for handling upload of archive "${archiveName}"`);
  }

  async _handleUploadData({userId, archiveName, orderNumber, data}: UploadDataMessage['value']) {
    const redisKey = this._getProcessedChunksRedisKey(userId, archiveName);
    await this._redisClient.incr(redisKey);
    const expectedChunkOrderNumber = +(await this._redisClient.get(redisKey))!;
    if (orderNumber !== expectedChunkOrderNumber) {
      await this._sendUploadAcknowledgeMessage('error', {
        userId,
        archiveName,
        status: 'error',
        errorMessage: 'Unexpected error during file upload handling'
      });
      this._logger.error(
        `Failed to handle chunk of archive "${archiveName}": chunk order number (${orderNumber}) doesn't match ` +
          `expected (${expectedChunkOrderNumber})`
      );
      return;
    }
    const {filePath} = this._getArchivePath(userId, archiveName);
    await fs.promises.writeFile(filePath, Buffer.from(data, 'base64'), {mode: 'a'});
    this._logger.debug(`Successfully handled chunk of archive "${archiveName}"`);
  }

  async _handleUploadFinish({userId, archiveName, chunkAmount, checksum, iv}: UploadFinishMessage['value']) {
    try {
      const processedChunks = +(await this._redisClient.getdel(this._getProcessedChunksRedisKey(userId, archiveName)))!;
      if (processedChunks !== chunkAmount) {
        await this._sendUnexpectedErrorMessage(userId, archiveName);
        this._logger.error(
          `Failed to handle upload finish of archive "${archiveName}": processed chunk amount (${processedChunks}) ` +
            `doesn't match total archive chunks (${chunkAmount})`
        );
        return;
      }
      await this._archiveModel.findOneAndUpdate({userId, name: archiveName}, {checksum, iv});
      await this._sendUploadAcknowledgeMessage('finish', {userId, archiveName, status: 'ok'});
      this._logger.debug(`Successfully handled upload finish of archive "${archiveName}"`);
    } catch (error) {
      await this._sendUnexpectedErrorMessage(userId, archiveName);
      this._logger.error(`Failed to handle upload finish of archive "${archiveName}"`, error);
      await this._cleanArchiveData(userId, archiveName);
    }
  }

  async _handleUploadAbort({userId, archiveName}: UploadAbortMessage['value']) {
    await this._cleanArchiveData(userId, archiveName);
    this._logger.debug(`Successfully handled upload abort of archive "${archiveName}"`);
  }

  async _cleanArchiveData(userId: string, archiveName: string) {
    await this._redisClient.del(this._getProcessedChunksRedisKey(userId, archiveName));
    const archive = await this._archiveModel.findOneAndDelete({userId, name: archiveName});
    const {filePath} = this._getArchivePath(archive!.userId, archive!.name);
    await fs.promises.rm(filePath, {recursive: true, force: true});
  }

  _sendUploadAcknowledgeMessage(key: string, value: unknown) {
    return this._kafkaProducer.send({topic: UPLOAD_ACKNOWLEDGE_TOPIC, messages: [{key, value: JSON.stringify(value)}]});
  }

  _sendUnexpectedErrorMessage(userId: string, archiveName: string) {
    return this._sendUploadAcknowledgeMessage('error', {
      userId,
      archiveName,
      status: 'error',
      errorMessage: 'Unexpected error during file upload handling'
    });
  }

  private _getArchivePath(userId: string, archiveName: string) {
    const dirPath = path.join(this._config.storage.path, userId);
    const filePath = path.join(dirPath, archiveName);
    return {dirPath, filePath};
  }

  private _getProcessedChunksRedisKey(userId: string, archiveName: string) {
    return userId + ':' + archiveName + ':processed-chunks';
  }
}
