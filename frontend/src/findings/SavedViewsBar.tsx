import { useEffect, useMemo, useState } from "react";

import {
  createSharedFindingView,
  deleteSharedFindingView,
  fetchSharedFindingViews,
  type SharedFindingView,
} from "../api/findings";
import { ApiError } from "../api/client";
import type { OperatorSession } from "../auth/session";
import type { FindingsFilters } from "./types";
import {
  deleteSavedView,
  describeFilters,
  loadSavedViews,
  sanitizeSavedFilters,
  saveCurrentFilters,
  validateFiltersForApply,
  type SavedFindingView,
} from "./savedViews";

interface Props {
  session: OperatorSession;
  filters: FindingsFilters;
  disabled?: boolean;
  onApply: (filters: FindingsFilters) => void;
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

export function SavedViewsBar({
  session,
  filters,
  disabled,
  onApply,
}: Props) {
  const [localViews, setLocalViews] = useState<SavedFindingView[]>(() =>
    loadSavedViews(session),
  );
  const [sharedViews, setSharedViews] = useState<SharedFindingView[]>([]);
  const [sharedLoadError, setSharedLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saveTarget, setSaveTarget] = useState<SaveTarget>("shared");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalViews(loadSavedViews(session));
    setMessage(null);
    setError(null);
    let cancelled = false;
    setSharedLoadError(null);
    void (async () => {
      try {
        const views = await fetchSharedFindingViews(session);
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

  const hint = useMemo(() => describeFilters(filters), [filters]);

  async function onSave() {
    setMessage(null);
    setError(null);
    if (saveTarget === "local") {
      const result = saveCurrentFilters({
        session,
        name,
        filters,
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
      const view = await createSharedFindingView(session, { name, filters });
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
    const result = deleteSavedView({ session, id });
    setLocalViews(result.views);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("Local view removed.");
  }

  async function onDeleteShared(id: string) {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await deleteSharedFindingView(session, id);
      setSharedViews((prev) => prev.filter((v) => v.id !== id));
      setMessage("Shared view removed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;

  function tryApply(
    label: "shared" | "local",
    name: string,
    rawFilters: unknown,
  ) {
    setMessage(null);
    setError(null);
    const next = sanitizeSavedFilters(rawFilters);
    if (!next) {
      setError(
        label === "shared"
          ? "This shared view has obsolete or invalid filters. Delete it and create a new one."
          : "This local view has obsolete or invalid filters. Delete it and create a new one.",
      );
      return;
    }
    const identity = validateFiltersForApply(session, next);
    if (!identity.ok) {
      setError(identity.message);
      return;
    }
    onApply(next);
    setMessage(
      label === "shared"
        ? `Applied shared “${name}”.`
        : `Applied local “${name}”.`,
    );
  }

  return (
    <div className="saved-views" aria-label="Saved views">
      <div className="saved-views-row">
        <span className="muted tiny">Shared (tenant)</span>
        {sharedLoadError ? (
          <span className="error tiny" role="status">
            Shared views unavailable: {sharedLoadError}
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
                  title={describeFilters(view.filters)}
                  onClick={() => tryApply("shared", view.name, view.filters)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-delete"
                  disabled={locked}
                  aria-label={`Delete shared view ${view.name}`}
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
        <span className="muted tiny">This browser</span>
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
                  title={describeFilters(view.filters)}
                  onClick={() => tryApply("local", view.name, view.filters)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary saved-view-delete"
                  disabled={locked}
                  aria-label={`Delete local view ${view.name}`}
                  onClick={() => onDeleteLocal(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="saved-views-row saved-views-save">
        <label className="saved-view-name">
          Name
          <input
            type="text"
            value={name}
            disabled={locked}
            maxLength={40}
            placeholder="e.g. Open churn"
            aria-label="Saved view name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="saved-view-target" disabled={locked}>
          <legend className="visually-hidden">Save destination</legend>
          <label>
            <input
              type="radio"
              name="save-target"
              checked={saveTarget === "shared"}
              onChange={() => setSaveTarget("shared")}
            />
            Share with tenant
          </label>
          <label>
            <input
              type="radio"
              name="save-target"
              checked={saveTarget === "local"}
              onChange={() => setSaveTarget("local")}
            />
            This browser only
          </label>
        </fieldset>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={locked || name.trim().length === 0}
          onClick={() => void onSave()}
          title={`Save: ${hint}`}
        >
          Save current filters
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
