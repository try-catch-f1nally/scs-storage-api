import {model, Schema} from 'mongoose';
import {ArchiveModel, ArchiveDocument} from './archive.model.interface';

const ArchiveSchema = new Schema<ArchiveDocument, ArchiveModel>({
  userId: {type: String, required: true, index: true},
  name: {type: String, required: true, unique: true, index: true},
  isTar: {type: Boolean, required: true},
  iv: {type: String, required: true},
  checksum: {type: String},
  sizeInBytes: {type: Number, required: true},
  createdAt: {type: Date, default: new Date()}
});

export const ArchiveModelImpl = model<ArchiveDocument, ArchiveModel>('Archive', ArchiveSchema);
