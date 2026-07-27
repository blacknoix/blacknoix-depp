import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api/client";
import {
  dismissFindingsAttentionItem,
  fetchFindings,
  fetchFindingsAttention,
  patchFinding,
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
import {
  collectVisibleFindingIds,
  formatBulkActionMessage,
  orderedBulkIds,
  patchForBulkAction,
  pruneBulkSelection,
  summarizeBulkResults,
  toggleBulkSelection,
  type BulkAction,
  type BulkActionItemResult,
} from "./bulkActions";
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
  const [bulkPending, setBulkPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );

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

      const nextData: WorkQueueData = {
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
      };

      setData(nextData);
      setSelectedIds((prev) =>
        pruneBulkSelection(
          prev,
          collectVisibleFindingIds({
            actionNeeded: nextData.actionNeeded,
            remindersDue: nextData.remindersDue,
            mine: nextData.mine,
            unownedOpen: nextData.unownedOpen,
          }),
        ),
      );
      setPhase("ready");
    } catch (err) {
      setData(emptyData);
      setSelectedIds(new Set());
      setError(errorMessage(err));
      setPhase("error");
    }
  }, [session, hasIdentity]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSelected(findingId: string) {
    if (!hasIdentity || bulkPending || dismissPending) {
      return;
    }
    setSelectedIds((prev) => toggleBulkSelection(prev, findingId));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

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

  async function runBulkAction(action: BulkAction) {
    if (!hasIdentity || bulkPending) {
      return;
    }
    const ids = orderedBulkIds(selectedIds);
    if (ids.length === 0) {
      return;
    }

    setBulkPending(true);
    setError(null);
    setMessage(null);

    const patch = patchForBulkAction(action);
    const results: BulkActionItemResult[] = [];

    for (const findingId of ids) {
      try {
        await patchFinding(session, findingId, patch);
        results.push({ findingId, ok: true });
      } catch (err) {
        results.push({
          findingId,
          ok: false,
          error: errorMessage(err),
        });
      }
    }

    const summary = summarizeBulkResults(action, results);
    setMessage(formatBulkActionMessage(summary));
    if (summary.failed.length > 0 && summary.succeeded.length === 0) {
      setError(
        summary.failed[0]?.error ??
          `${summary.failed.length} bulk action(s) failed.`,
      );
    }

    const failedIds = new Set(summary.failed.map((row) => row.findingId));
    setSelectedIds(failedIds);

    try {
      await load();
    } finally {
      setBulkPending(false);
    }
  }

  return {
    phase,
    error,
    message,
    data,
    hasIdentity,
    dismissPending,
    bulkPending,
    selectedIds,
    reload: load,
    dismissFollowUp,
    toggleSelected,
    clearSelection,
    runBulkAction,
  };
}
