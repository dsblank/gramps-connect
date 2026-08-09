import { Divider, Stack, Tooltip, UnstyledButton, Image } from "@mantine/core";
import { VIEWS } from "../store/views";
import classes from "./Sidebar.module.css";

interface SidebarProps {
  activeKey: string;
  onSelect: (key: string) => void;
}

/** Icon-only rail, one gramps-*.svg per object type -- modeled on the
 * category rail down the left edge of the Gramps desktop client. */
export function Sidebar({ activeKey, onSelect }: SidebarProps) {
  return (
    <Stack gap={2} align="center" py="sm">
      {VIEWS.map((view) => (
        <div key={view.key}>
          {view.sidebarSeparatorBefore && <Divider my="xs" />}
          <Tooltip label={view.label} position="right" withArrow openDelay={300}>
            <UnstyledButton
              className={classes.item}
              data-active={view.key === activeKey || undefined}
              onClick={() => onSelect(view.key)}
              aria-label={view.label}
              aria-current={view.key === activeKey}
            >
              <Image src={view.icon} alt="" w={32} h={32} />
            </UnstyledButton>
          </Tooltip>
        </div>
      ))}
    </Stack>
  );
}
