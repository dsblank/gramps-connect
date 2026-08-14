import { Divider, ScrollArea, Stack, Tooltip, UnstyledButton, Image } from "@mantine/core";
import { HOME_KEY } from "../hash";
import { VIEWS } from "../store/views";
import iconHome from "../assets/icons/gramps-home.svg";
import classes from "./Sidebar.module.css";

interface SidebarProps {
  activeKey: string;
  onSelect: (key: string) => void;
}

/** Icon-only rail, one gramps-*.svg per object type -- modeled on the
 * category rail down the left edge of the Gramps desktop client.
 *
 * Scrolls within itself rather than running off the bottom of the window:
 * AppShell.Navbar is a fixed-height flex column (viewport minus the header
 * and, when docked, the footer), so `flex: 1` + `minHeight: 0` sizes this
 * ScrollArea to exactly the space between them and the icons that don't
 * fit on a short window become scrollable instead of hidden underneath the
 * status bar. Overlay scrollbar (Mantine's own, not a native one), so it
 * costs the 68px rail no width. */
export function Sidebar({ activeKey, onSelect }: SidebarProps) {
  return (
    <ScrollArea type="auto" scrollbarSize={6} style={{ flex: 1, minHeight: 0 }}>
      <Stack gap={2} align="center" py="sm">
        {/* Above the object-type list and set off by its own divider: a
            dashboard overview isn't another data type alongside People/
            Events/..., it's the page this whole rail returns to. */}
        <Tooltip label="Home" position="right" withArrow openDelay={300}>
          <UnstyledButton
            className={classes.item}
            data-active={activeKey === HOME_KEY || undefined}
            onClick={() => onSelect(HOME_KEY)}
            aria-label="Home"
            aria-current={activeKey === HOME_KEY}
          >
            <Image src={iconHome} alt="" w={32} h={32} />
          </UnstyledButton>
        </Tooltip>
        <Divider my="xs" />
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
    </ScrollArea>
  );
}
