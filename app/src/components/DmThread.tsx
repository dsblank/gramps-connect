import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text } from "@mantine/core";
import { getToken, getCurrentUsername } from "../auth/auth";
import { closeDmThread, getOpenPeer, subscribeDmUi } from "../store/dmUi";
import {
  bumpDmActivity,
  createDm,
  fetchDmPool,
  getDmActivityVersion,
  groupDmConversations,
  subscribeDmActivity,
  type DmMessage,
} from "../store/dmApi";
import { markRead } from "../store/dmReadState";
import { recordKnownUser } from "../store/knownUsers";
import { displayName, getUserDirectoryVersion, subscribeUserDirectory } from "../store/userDirectory";
import { MessageComposer } from "./MessageComposer";
import { t } from "../i18n/i18n";

/** The one DM thread modal for the whole app -- ActiveUsers.tsx (clicking
 * an avatar) and DmInbox.tsx (clicking a conversation row) both just call
 * dmUi.ts's openDmThread(username) rather than each rendering their own
 * copy of this. Mounted once, next to ActiveUsers in App.tsx's header. */
export function DmThread() {
  const peer = useSyncExternalStore(subscribeDmUi, getOpenPeer);
  useSyncExternalStore(subscribeUserDirectory, getUserDirectoryVersion);
  // Bumped by App.tsx's onRemoteNoteChange on any incoming DM (mine or not)
  // and by this component's own afterSend below -- included so an incoming
  // reply while this thread is already open gets picked up the same way a
  // fresh open does, instead of only refreshing on the next peer switch.
  const activityVersion = useSyncExternalStore(subscribeDmActivity, getDmActivityVersion);
  const [history, setHistory] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Used by the effect below, keyed off both `peer` (switching threads) and
  // `activityVersion` (my own just-sent message, or an incoming one --
  // afterSend below just calls bumpDmActivity() and lets this same path
  // pick it up, same "immediate feedback" MessageComposer's own save()
  // comment describes for the board-message path; there, requeryDebounced()
  // feeds a ViewStore a parent panel already re-renders from, but a DM
  // thread has no such ViewStore (see views.ts's DM_VIEW doc comment), so
  // this refetches directly instead).
  const load = useCallback(async (currentPeer: string) => {
    setLoading(true);
    const token = await getToken();
    const me = getCurrentUsername() ?? "";
    const pool = await fetchDmPool(token, 1000);
    const conversations = groupDmConversations(me, pool);
    const messages = conversations.get(currentPeer) ?? [];
    setHistory(messages);
    setLoading(false);

    // The newest message *from the partner* (not one of my own) is what
    // "read" actually means here -- my own sent messages don't need to mark
    // anything as read.
    const incomingFromPartner = messages.filter((m) => m.author === currentPeer);
    const newestIncoming = incomingFromPartner[incomingFromPartner.length - 1]?.change;
    markRead(currentPeer, newestIncoming ?? Math.floor(Date.now() / 1000));
    recordKnownUser(currentPeer);
  }, []);

  useEffect(() => {
    if (!peer) return;
    let cancelled = false;
    load(peer).catch((err) => {
      if (!cancelled) setLoading(false);
      console.error("failed to load DM conversation", err);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activityVersion is a signal to refetch, not data this effect reads directly
  }, [peer, load, activityVersion]);

  if (!peer) return null;

  return (
    <MessageComposer
      opened
      onOpenChange={(open) => {
        if (!open) closeDmThread();
      }}
      about={
        <>
          {t("Direct message with")} <Text span fw={600} inherit>{displayName(peer)}</Text>
          {loading && <Text span c="dimmed" inherit> ({t("loading…")})</Text>}
        </>
      }
      history={history}
      renderTrigger={() => null}
      send={(token, author, text) => createDm(token, author, peer, text)}
      // bumpDmActivity() alone is enough -- it flows back through
      // activityVersion into the load effect above, same path an incoming
      // reply from the peer takes, rather than a second, redundant fetch
      // racing that one.
      afterSend={() => bumpDmActivity()}
    />
  );
}
