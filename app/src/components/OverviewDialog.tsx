import { Anchor, List, Modal, ScrollArea, Stack, Text, Title } from "@mantine/core";

interface OverviewDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Help > Overview: what this program is trying to be, in plain language.
 *
 * Deliberately written for someone who is a genealogist rather than a
 * programmer -- no jargon from either field, and nothing about how any of
 * it is built beyond what changes what the reader sees on screen. It's the
 * one place that says out loud that this is an experiment, and how it
 * relates to Gramps Web, so nobody has to work that out from the way the
 * app behaves. Static prose, so it's a plain component with no data of its
 * own; kept beside the other Help content rather than in a docs site so it
 * travels with the app and works offline. */
export function OverviewDialog({ opened, onClose }: OverviewDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Overview"
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="lg">
        <Section title="What this is">
          <Text size="sm">
            Gramps Connect lets you look at a family tree in your web browser. The tree
            itself lives on a server somewhere — your own computer, a family member's, or
            a rented one — and several people can be looking at it, and working on it, at
            the same time.
          </Text>
          <Text size="sm">
            It is an experiment. It is being built to try out a handful of ideas about
            what a family tree program on the web could feel like, and those ideas are
            what the rest of this page describes.
          </Text>
        </Section>

        <Section title="It works the way Gramps does">
          <Text size="sm">
            If you have used Gramps on a desktop computer, this should feel familiar on
            purpose. The icons down the left-hand side switch between the same lists —
            People, Families, Events, Places, and the rest — and the menus across the top
            are the ones you already know: Family Trees, View, Reports, Help.
          </Text>
          <Text size="sm">
            That is not just decoration. Genealogy is a long hobby, and people carry
            years of habits with them. Somewhere new to click for something you have
            clicked a thousand times is a real cost, so the aim is that what you learned
            in Gramps keeps working here.
          </Text>
        </Section>

        <Section title="It is built for working together">
          <Text size="sm">
            Family history is rarely a solo project. A cousin has the photographs, an
            aunt remembers the names, someone else is the one who actually types things
            in. So this is designed around more than one person being in the tree at
            once:
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>
              <b>You see other people's changes as they happen.</b> When someone else
              corrects a date or adds a person, the list you are looking at updates by
              itself. You do not have to reload the page, and you will not spend an hour
              working from a copy of the tree that went stale while you read it.
            </List.Item>
            <List.Item>
              <b>You can leave messages for each other.</b> The Messages list is a
              conversation attached to the tree itself, not a separate chat program.
              Everyone who can see the tree can see it, including whoever joins next
              year, and you get a notification when a new one arrives.
            </List.Item>
            <List.Item>
              <b>What you produce is shared.</b> When you run a report or export the
              tree, the finished file does not just land in your own downloads folder. It
              appears in the Output list, where everyone else can find it and download it
              too.
            </List.Item>
          </List>
        </Section>

        <Section title="It is built to be fast">
          <Text size="sm">
            Large family trees — tens of thousands of people — have historically been
            slow to browse over the web. A single search could take well over a minute,
            which is long enough that you stop searching.
          </Text>
          <Text size="sm">
            Two things are done about that. The server has been taught to answer with
            just the handful of details a list needs, rather than assembling every record
            in full and then throwing most of it away. And your browser keeps its own
            copy of what it has already been sent, so scrolling, sorting and filtering
            happen right where you are, with nothing to wait for. It should feel more
            like searching the contacts already on your phone than like looking someone
            up over a slow connection.
          </Text>
          <Text size="sm">
            The copy in your browser also survives closing the tab, so coming back
            tomorrow does not start from nothing.
          </Text>
        </Section>

        <Section title="You dig in without losing your place">
          <Text size="sm">
            The usual way a website handles "tell me more about this" is to take you to
            another page. Do that three or four times while following a family and you
            have forgotten where you started.
          </Text>
          <Text size="sm">
            Here, the list stays where it is. Click a person and their details open
            beside the list. Click one of their events, or a source backing it up, and
            that opens below the details — so the person, the thing of theirs you are
            looking at, and the list you found them in are all still on screen together.
            Only when you deliberately go somewhere else do you actually leave.
          </Text>
        </Section>

        <Section title="How this differs from Gramps Web">
          <Text size="sm">
            Gramps Web is the established way to use Gramps in a browser. It is a real,
            finished, supported program that a lot of people rely on every day, and if
            you want to put your family tree online today, that is what you want. This is
            not a replacement for it, and it may never be one. Both talk to the same
            server software and the same tree, so using one does not rule out the other.
          </Text>
          <Text size="sm">The differences worth knowing:</Text>
          <List size="sm" spacing="xs">
            <List.Item>
              <b>Maturity.</b> Gramps Web is finished software. This is an experiment
              under active construction, and parts of it are missing or will change.
            </List.Item>
            <List.Item>
              <b>Editing.</b> Gramps Web lets you edit your tree. Here, editing is barely
              started — this is mostly for browsing and reading so far. Several of the
              menus are still empty.
            </List.Item>
            <List.Item>
              <b>Shape.</b> Gramps Web has its own design, built for phones first. This
              one copies the desktop Gramps layout, which suits a large screen and
              someone who already knows Gramps.
            </List.Item>
            <List.Item>
              <b>Speed on big trees.</b> Gramps Web asks the server each time you search
              or sort. This keeps a copy in your browser and answers instantly, which
              matters most on very large trees.
            </List.Item>
            <List.Item>
              <b>Staying current.</b> In Gramps Web you reload to see someone else's
              changes. Here they arrive on their own.
            </List.Item>
          </List>
        </Section>

        <Section title="What to expect">
          <Text size="sm">
            Treat this as something to try, not somewhere to keep the only copy of your
            research. Keep your tree backed up, as you would anyway. Empty menus, missing
            features and things that move between visits are all expected at this stage.
          </Text>
          <Text size="sm">
            Questions, complaints and ideas are all genuinely useful right now — the{" "}
            <Anchor href="https://gramps.discourse.group/" target="_blank" rel="noreferrer">
              Gramps forum
            </Anchor>{" "}
            is where this is discussed, and the{" "}
            <Anchor
              href="https://github.com/dsblank/gramps-connect"
              target="_blank"
              rel="noreferrer"
            >
              source code
            </Anchor>{" "}
            is public.
          </Text>
        </Section>
      </Stack>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {children}
    </Stack>
  );
}
