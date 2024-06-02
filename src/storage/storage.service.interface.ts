import {Archive} from './archive.model.interface';

export interface StorageService {
  getUserArchives(userId: string): Promise<Archive[]>;
  deleteArchive(userId: string, archiveName: string): Promise<void>;
  initiateDownload(userId: string, archiveName: string): Promise<BaseArchiveMetadata>;
}

export type BaseArchiveMetadata = {
  iv: string;
  isTar: boolean;
  checksum: string;
};
