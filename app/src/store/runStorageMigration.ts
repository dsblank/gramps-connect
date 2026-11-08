// Side-effect module: main.tsx imports this FIRST, so the storage keys are
// moved to their new names before any other module (i18n, auth, Mantine)
// is evaluated and reads them. A call in main.tsx's body would be too late:
// ES imports are all evaluated before the importing module's own code.
import { migrateStorageKeys } from "./storageMigration";

migrateStorageKeys();
