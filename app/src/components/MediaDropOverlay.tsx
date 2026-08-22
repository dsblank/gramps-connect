import { Box, Center, Stack, Text } from "@mantine/core";
import type { MediaDropState } from "../hooks/useMediaDrop";

/** Full-window visual feedback while a file is being dragged over the app
 * (useMediaDrop.ts) -- pointer-events: none throughout, since the drag/drop
 * listeners it's reporting on live on `window` itself and don't need this
 * overlay as their target. Rendered unconditionally by App.tsx; returns
 * null itself while inactive rather than App.tsx conditionally mounting it,
 * so there's nothing to mount/unmount on every drag start/end. */
export function MediaDropOverlay({ active, targetLabel }: MediaDropState) {
  if (!active) return null;
  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "light-dark(rgba(0, 0, 0, 0.25), rgba(0, 0, 0, 0.55))",
        pointerEvents: "none",
      }}
    >
      <Center h="100%">
        <Stack
          align="center"
          gap={4}
          p="xl"
          style={{
            background: "var(--mantine-color-body)",
            borderRadius: "var(--mantine-radius-md)",
            border: "2px dashed var(--mantine-color-blue-5)",
          }}
        >
          <Text fw={600}>Drop to add media</Text>
          <Text size="sm" c="dimmed">{targetLabel}</Text>
        </Stack>
      </Center>
    </Box>
  );
}
