import { Anchor, Group, Image, Modal, Stack, Text, Title } from "@mantine/core";
import { API_BASE } from "../config";
import { getCurrentUsername } from "../auth/auth";
import logo from "../assets/icons/gramps-logo.svg";

interface AboutDialogProps {
  opened: boolean;
  onClose: () => void;
  /** Opens Help > Overview, which is where the "what is this?" answer this
   * dialog only gestures at actually lives. */
  onShowOverview: () => void;
}

/** Help > About: what this is, in one paragraph, plus who and what it's
 * currently talking to.
 *
 * Only the two facts a reader can't get from the window itself: which
 * account they're signed in as, and which server that is. Version numbers
 * are deliberately elsewhere (Help > System Information) -- one line here
 * would tempt someone into reporting a bug with the frontend version and
 * nothing else, which is the least useful third of that block. */
export function AboutDialog({ opened, onClose, onShowOverview }: AboutDialogProps) {
  // API_BASE is "" for a same-origin deployment (see config.ts), where the
  // page's own address is the honest answer.
  const server = API_BASE || window.location.origin;
  const username = getCurrentUsername();

  return (
    <Modal opened={opened} onClose={onClose} title="About">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <Image src={logo} alt="" w={48} h={48} />
          <Stack gap={0}>
            <Title order={4}>Gramps Connect</Title>
            <Text size="sm" c="dimmed">
              Version {__APP_VERSION__}
            </Text>
          </Stack>
        </Group>

        <Text size="sm">
          A way to browse a{" "}
          <Anchor href="https://gramps-project.org/" target="_blank" rel="noreferrer">
            Gramps
          </Anchor>{" "}
          family tree in your browser, together with other people, built to stay quick on
          very large trees.{" "}
          <Anchor component="button" type="button" onClick={onShowOverview}>
            Read the overview
          </Anchor>{" "}
          for what it is trying to do differently.
        </Text>

        <Text size="sm">
          This is an experiment rather than finished software, and it is not an official
          release of the Gramps Project. Keep your tree backed up.
        </Text>

        <Stack gap={2}>
          <Text size="sm">
            <b>Signed in as:</b> {username ?? "unknown"}
          </Text>
          <Text size="sm" style={{ overflowWrap: "anywhere" }}>
            <b>Server:</b> {server}
          </Text>
        </Stack>

        <Text size="sm" c="dimmed">
          Free software under the AGPL-3.0-or-later licence. Source, issues and discussion:{" "}
          <Anchor href="https://github.com/dsblank/gramps-connect" target="_blank" rel="noreferrer">
            github.com/dsblank/gramps-connect
          </Anchor>
          .
        </Text>
      </Stack>
    </Modal>
  );
}
