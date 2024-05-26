import {Document, Model} from 'mongoose';

export interface Archive {
  userId: string;
  name: string;
  checksum?: string;
  iv?: string;
  sizeInBytes: number;
  createdAt: Date;
}

export interface ArchiveDocument extends Archive, Document {}

export type ArchiveModel = Model<ArchiveDocument>;
