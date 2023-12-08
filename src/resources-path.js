import {app} from 'electron/main';
import path from 'node:path';

export default app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');