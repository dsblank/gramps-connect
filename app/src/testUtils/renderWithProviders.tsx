// Test-only render helper -- wraps a component the same way main.tsx does
// for real (MantineProvider + Notifications), since nearly everything in
// this app (Modal, Tooltip, TagsInput, ...) needs MantineProvider context to
// render at all, and several components (DeleteButton's confirm dialog,
// TopicThread's own error path) call @mantine/notifications' own
// notifications.show() directly, which needs <Notifications/> mounted to
// actually do anything. Not itself a *.test.ts(x) file (vite.config.ts's
// own `include` only picks those up), so it's never mistaken for an empty
// test suite.
import type { ReactElement, ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { render, type RenderOptions } from "@testing-library/react";
import { theme } from "../theme";

function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme}>
      <Notifications />
      {children}
    </MantineProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: Providers, ...options });
}

export * from "@testing-library/react";
