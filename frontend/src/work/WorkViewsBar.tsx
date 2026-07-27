import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import {
  createSharedWorkView,
  deleteSharedWorkView,
  fetchSharedWorkViews,
  type SharedWorkView,
} from "../api/work";
import type { OperatorSession } from "../auth/session";
import type { WorkQueueSectionId } from "./workQueue";
import {
  deleteSavedWorkView,
  describeWorkSections,
  loadSavedWorkViews,
  sanitizeWorkViewDefinition,
  saveCurrentWorkView,
  validateWorkDefinitionForApply,
  type SavedWorkView,
} from "./savedWorkViews";

interface Props {
  session: OperatorSession;
  sections: readonly WorkQueueSectionId[];
  disabled?: boolean;
  onApply: (sections: WorkQueueSectionId[]) => void;
}

type SaveTarget = "local" | "shared";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

/**
 * Compact local + tenant-shared Work section views.
 * Not folders, not collaboration, not a preferences platform.
 */
export function WorkViewsBar({
  session,
  sections,
  disabled,
  onApply,
}: Props) {
  const [localViews, setLocalViews] = useState<SavedWorkView[]>(() =>
    loadSavedWorkViews(session),
  );
  const [sharedViews, setSharedViews] = useState<SharedWorkView[]>([]);
  const [sharedLoadError, setSharedLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saveTarget, setSaveTarget] = useState<SaveTarget>("shared");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalViews(loadSavedWorkViews(session));
    setMessage(null);
    setError(null);
    let cancelled = false;
    setSharedLoadError(null);
    void (async () => {
      try {
        const views = await fetchSharedWorkViews(session);
        if (!cancelled) {
          setSharedViews(views);
        }
      } catch (err) {
        if (!cancelled) {
          setSharedViews([]);
          setSharedLoadError(errorMessage(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const hint = useMemo(() => describeWorkSections(sections), [sections]);

  async function onSave() {
    setMessage(null);
    setError(null);
    const definition = { sections: [...sections] };

    if (saveTarget === "local") {
      const result = saveCurrentWorkView({
        session,
        name,
        definition,
      });
      setLocalViews(result.views);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setMessage(`Saved locally “${result.view.name}”.`);
      return;
    }

    setBusy(true);
    try {
      const view = await createSharedWorkView(session, { name, definition });
      setSharedViews((prev) => [view, ...prev.filter((v) => v.id !== view.id)]);
      setName("");
      setMessage(`Shared “${view.name}” with this tenant.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onDeleteLocal(id: string) {
    setMessage(null);
    setError(null);
    const result = deleteSavedWorkView({ session, id });
    setLocalViews(result.views);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("Local Work view removed.");
  }

  async function onDeleteShared(id: string) {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await deleteSharedWorkView(session, id);
      setSharedViews((prev) => prev.filter((v) => v.id !== id));
      setMessage("Shared Work view removed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;

  function tryApply(
    label: "shared" | "local",
    viewName: string,
    rawDefinition: unknown,
  ) {
    setMessage(null);
    setError(null);
    const next = sanitizeWorkViewDefinition(rawDefinition);
    if (!next) {
      setError(
        label === "shared"
          ? "This shared Work view has obsolete or invalid sections. Delete it and create a new one."
          : "This local Work view has obsolete or invalid sections. Delete it and create a new one.",
      );
      return;
    }
    const identity = validateWorkDefinitionForApply(session, next);
    if (!identity.ok) {
      setError(identity.message);
      return;
    }
    onApply(next.sections);
    setMessage(
      label === "shared"
        ? `Applied shared “${viewName}”.`
        : `Applied local “${viewName}”.`,
    );
  }

  return (
    <div className="saved-views" aria-label="Work views">
      <div className="saved-views-row">
        <span className="muted tiny">Shared (tenant)</span>
        {sharedLoadError ? (
          <span className="error tiny" role="status">
            Shared Work views unavailable: {sharedLoadError}
          </span>
        ) : sharedViews.length === 0 ? (
          <span className="muted tiny">None yet.</span>
        ) : (
          <ul className="saved-view-chips">
            {sharedViews.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-apply"
                  disabled={locked}
                  title={describeWorkSections(view.definition.sections)}
                  onClick={() =>
                    tryApply("shared", view.name, view.definition)
                  }
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-delete"
                  disabled={locked}
                  aria-label={`Delete shared Work view ${view.name}`}
                  onClick={() => void onDeleteShared(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="saved-views-row">
        <span className="muted tiny">Local (this browser)</span>
        {localViews.length === 0 ? (
          <span className="muted tiny">None yet.</span>
        ) : (
          <ul className="saved-view-chips">
            {localViews.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-apply"
                  disabled={locked}
                  title={describeWorkSections(view.definition.sections)}
                  onClick={() =>
                    tryApply("local", view.name, view.definition)
                  }
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-delete"
                  disabled={locked}
                  aria-label={`Delete local Work view ${view.name}`}
                  onClick={() => onDeleteLocal(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="saved-views-save">
        <label className="tiny muted" htmlFor="work-view-name">
          Save current sections
        </label>
        <input
          id="work-view-name"
          type="text"
          value={name}
          disabled={locked}
          maxLength={40}
          placeholder={hint}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="Save Work view target"
          value={saveTarget}
          disabled={locked}
          onChange={(event) =>
            setSaveTarget(event.target.value as SaveTarget)
          }
        >
          <option value="shared">Shared with tenant</option>
          <option value="local">Local only</option>
        </select>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={locked || name.trim() === ""}
          onClick={() => void onSave()}
        >
          Save
        </button>
      </div>

      {message ? (
        <p className="muted tiny" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="error tiny" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
