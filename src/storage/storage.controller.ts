import {Controller, Middleware, NextFunction, Request, Response, Router} from '@try-catch-f1nally/express-microservice';
import {StorageService} from './storage.service.interface';

export class StorageController implements Controller {
  private _router = Router();
  private _storageService: StorageService;
  private _authMiddleware: Middleware;

  constructor(storageService: StorageService, authMiddleware: Middleware) {
    this._storageService = storageService;
    this._authMiddleware = authMiddleware;
    this._initializeRouter();
  }

  get router() {
    return this._router;
  }

  private _initializeRouter() {
    this.router.get('/archives', this._authMiddleware.middleware, this._getUserArchives.bind(this));
    this.router.post(
      '/archives/download/:userId/:archiveName',
      this._authMiddleware.middleware,
      this._initiateDownloading.bind(this)
    );
    this.router.delete(
      '/archives/:userId/:archiveName',
      this._authMiddleware.middleware,
      this._deleteArchive.bind(this)
    );
  }

  private async _getUserArchives(req: Request, res: Response, next: NextFunction) {
    try {
      const userArchives = await this._storageService.getUserArchives(req.user!.id);
      return res.status(200).json(userArchives);
    } catch (error) {
      next(error);
    }
  }

  private async _initiateDownloading(req: Request, res: Response, next: NextFunction) {
    try {
      const {userId, archiveName} = req.params;
      await this._storageService.initiateDownload(userId, archiveName);
      return res.sendStatus(202);
    } catch (error) {
      next(error);
    }
  }

  private async _deleteArchive(req: Request, res: Response, next: NextFunction) {
    try {
      const {userId, archiveName} = req.params;
      await this._storageService.deleteArchive(userId, archiveName);
      return res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  }
}
