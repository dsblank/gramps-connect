import { useEffect, useState } from "react";
import { Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { getCurrentUsername, getToken, logout } from "../auth/auth";
import { fetchTree } from "../store/adminApi";
import type { ForeignTreeLink } from "../hooks/useHistorySync";
import { t } from "../i18n/i18n";

interface ForeignTreeDialogProps {
  link: ForeignTreeLink | null;
  /** The signed-in tree's name, when known (App.tsx's header). */
  currentTreeName: string | null;
  onClose: () => void;
}

/** Shown instead of following a link that names another tree (hash.ts's
 * isForeignRoute): its handles mean nothing in this one, so following it
 * would only land on a missing record. A session is tied to one tree (the
 * `tree` claim in gramps-web-api's token), so the way to that tree is to
 * sign in with an account for it -- which this offers, keeping the link so
 * signing in lands on it. */
export function ForeignTreeDialog({ link, currentTreeName, onClose }: ForeignTreeDialogProps) {
  // Only a site admin may read another tree's details; everyone else just
  // sees that it is another tree.
  const [linkTreeName, setLinkTreeName] = useState<string | null>(null);
  useEffect(() => {
    setLinkTreeName(null);
    if (!link) return;
    let cancelled = false;
    (async () => {
      const tree = await fetchTree(await getToken(), link.treeId);
      if (!cancelled) setLinkTreeName(tree.name || null);
    })().catch(() => {
      // Not allowed to see it -- the generic wording below covers that.
    });
    return () => {
      cancelled = true;
    };
  }, [link]);

  function signInThere() {
    if (!link) return;
    // logout() reloads the current URL; put the link back first so the
    // sign-in that follows opens it.
    window.history.replaceState(null, "", link.hash);
    logout();
  }

  const current = currentTreeName ?? t("this tree");
  const username = getCurrentUsername();

  return (
    <Modal opened={link !== null} onClose={onClose} title={t("Link to a different tree")} size="md">
      <Stack gap="md">
        <Text size="sm">
          {linkTreeName
            ? t("This link is for the tree {other}, but you're signed in to {current}.")
                .replace("{other}", linkTreeName)
                .replace("{current}", current)
            : t("This link is for a different tree than the one you're signed in to ({current}).").replace(
                "{current}",
                current,
              )}
        </Text>
        <Text size="sm">
          {username
            ? t("To open it, sign out of {user} and sign in with an account for that tree.").replace("{user}", username)
            : t("To open it, sign out and sign in with an account for that tree.")}
        </Text>
        {!linkTreeName && (
          <Text size="xs" c="dimmed">
            {t("Tree ID:")} <Code>{link?.treeId}</Code>
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Stay here")}
          </Button>
          <Button onClick={signInThere}>{t("Sign in to that tree")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
