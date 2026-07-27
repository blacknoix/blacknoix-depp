import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api/client";
import {
  dismissFindingsAttentionItem,
  fetchFindings,
  fetchFindingsAttention,
  type AttentionItem,
  type DismissableAttentionKind,
  type FindingsAttentionDigest,
} from "../api/findings";
import {
  sessionHasOperatorIdentity,
  type OperatorSession,
} from "../auth/session";
import type { Finding } from "../findings/types";
import { loadAttentionSeenAt } from "../shell/attentionSeen";
import { capWorkQueueItems } from "./workQueue";

export type WorkQueuePhase = "idle" | "loading" | "ready" | "error";

export interface WorkQueueData {
  actionNeeded: AttentionItem[];
  actionNeededTruncated: boolean;
  remindersDue: AttentionItem[];
  remindersDueTruncated: boolean;
  mine: Finding[];
  mineTruncated: boolean;
  unownedOpen: Finding[];
  unownedOpenTruncated: boolean;
  attentionMeta: Pick<
    FindingsAttentionDigest,
    "actionNeeded" | "dueReminders" | "reminders"
  > | null;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

function isDismissableKind(
  kind: AttentionItem["kind"],
): kind is DismissableAttentionKind {
  return (
    kind === "finding.needs_revisit" ||
    kind === "finding.reminder_due" ||
    kind === "finding.action_needed"
  );
}

const emptyData: WorkQueueData = {
  actionNeeded: [],
  actionNeededTruncated: false,
  remindersDue: [],
  remindersDueTruncated: false,
  mine: [],
  mineTruncated: false,
  unownedOpen: [],
  unownedOpenTruncated: false,
  attentionMeta: null,
};

export function useWorkQueue(session: OperatorSession) {
  const [phase, setPhase] = useState<WorkQueuePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<WorkQueueData>(emptyData);
  const [dismissPending, setDismissPending] = useState(false);

  const hasIdentity = sessionHasOperatorIdentity(session);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const since = loadAttentionSeenAt(session);
      const attentionPromise = fetchFindingsAttention(session, since);
      const unownedPromise = fetchFindings(session, {
        ownerScope: "none",
        status: "open",
      });
      const minePromise = hasIdentity
        ? fetchFindings(session, { ownerScope: "me" })
        : Promise.resolve([] as Finding[]);

      const [attention, mine, unownedOpen] = await Promise.all([
        attentionPromise,
        minePromise,
        unownedPromise,
      ]);

      const actionCapped = capWorkQueueItems(
        hasIdentity ? attention.actionNeeded.items : [],
      );
      const dueCapped = capWorkQueueItems(
        hasIdentity ? attention.dueReminders.items : [],
      );
      const mineCapped = capWorkQueueItems(mine);
      const unownedCapped = capWorkQueueItems(unownedOpen);

      setData({
        actionNeeded: actionCapped.items,
        actionNeededTruncated:
          actionCapped.truncated || attention.actionNeeded.truncated,
        remindersDue: dueCapped.items,
        remindersDueTruncated:
          dueCapped.truncated || attention.dueReminders.truncated,
        mine: mineCapped.items,
        mineTruncated: mineCapped.truncated,
        unownedOpen: unownedCapped.items,
        unownedOpenTruncated: unownedCapped.truncated,
        attentionMeta: {
          actionNeeded: attention.actionNeeded,
          dueReminders: attention.dueReminders,
          reminders: attention.reminders,
        },
      });
      setPhase("ready");
    } catch (err) {
      setData(emptyData);
      setError(errorMessage(err));
      setPhase("error");
    }
  }, [session, hasIdentity]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismissFollowUp(item: AttentionItem) {
    if (!hasIdentity || !isDismissableKind(item.kind)) {
      return;
    }
    setDismissPending(true);
    setError(null);
    setMessage(null);
    try {
      await dismissFindingsAttentionItem(session, {
        findingId: item.findingId,
        kind: item.kind,
        conditionAt: item.at,
      });
      setMessage(
        "Dismissed until this finding's attention condition changes.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDismissPending(false);
    }
  }

  return {
    phase,
    error,
    message,
    data,
    hasIdentity,
    dismissPending,
    reload: load,
    dismissFollowUp,
  };
}
