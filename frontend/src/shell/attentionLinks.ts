/**
 * Map attention digest items onto Findings URL contexts.
 */

import type { AttentionItem } from "../api/findings";
import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type CorrelationRuleId,
  type FindingStatus,
} from "../findings/types";
import { findingsPath } from "../routing/crossLinks";

function isStatus(value: string): value is FindingStatus {
  return (FINDING_STATUSES as readonly string[]).includes(value);
}

function isRuleId(value: string): value is CorrelationRuleId {
  return (CORRELATION_RULE_IDS as readonly string[]).includes(value);
}

export function attentionItemPath(item: AttentionItem): string | null {
  if (!isStatus(item.status)) {
    return null;
  }
  if (!isRuleId(item.ruleId)) {
    return null;
  }

  if (
    item.kind === "finding.needs_revisit" ||
    item.kind === "finding.reminder_due" ||
    item.kind === "finding.action_needed"
  ) {
    // Ownership / reminder / escalation items land in Mine so queue context stays coherent.
    return findingsPath({
      ownerScope: "me",
      findingId: item.findingId,
    });
  }

  return findingsPath({
    status: item.status,
    ruleId: item.ruleId,
    findingId: item.findingId,
  });
}

export function attentionKindLabel(kind: AttentionItem["kind"]): string {
  if (kind === "finding.created") {
    return "New finding";
  }
  if (kind === "finding.needs_revisit") {
    return "Needs revisit";
  }
  if (kind === "finding.reminder_due") {
    return "Reminder due";
  }
  if (kind === "finding.action_needed") {
    return "Action needed";
  }
  return "Status change";
}
