import "./store/runStorageMigration";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { localStorageColorSchemeManager, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { theme } from "./theme";
import { App } from "./App";
import { STORAGE_KEYS } from "./store/storageKeys";

const colorSchemeManager = localStorageColorSchemeManager({ key: STORAGE_KEYS.colorScheme });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <Notifications />
      <App />
    </MantineProvider>
  </StrictMode>
);
