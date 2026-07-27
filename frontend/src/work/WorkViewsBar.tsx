import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client";
import {
  clearTenantWorkDefault,
  createSharedWorkView,
  deleteSharedWorkView,
  fetchSharedWorkViews,
  setTenantWorkDefault,
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

export interface TenantDefaultWorkView {
  viewId: string;
  name: string;
  sections: WorkQueueSectionId[];
}

interface Props {
  session: OperatorSession;
  sections: readonly WorkQueueSectionId[];
  disabled?: boolean;
  onApply: (sections: WorkQueueSectionId[]) => void;
  /** Fires after shared views load (or fail) and after set/clear/delete. */
  onTenantDefaultResolved: (value: TenantDefaultWorkView | null) => void;
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

function resolveDefault(
  views: SharedWorkView[],
  defaultViewId: string | null,
): TenantDefaultWorkView | null {
  if (!defaultViewId) {
    return null;
  }
  const view = views.find((v) => v.id === defaultViewId);
  if (!view) {
    return null;
  }
  const def = sanitizeWorkViewDefinition(view.definition);
  if (!def || def.sections.length === 0) {
    return null;
  }
  return { viewId: view.id, name: view.name, sections: def.sections };
}

/**
 * Compact local + tenant-shared Work section views, plus a single tenant
 * default pointer. Not folders, not collaboration, not a preferences platform.
 */
export function WorkViewsBar({
  session,
  sections,
  disabled,
  onApply,
  onTenantDefaultResolved,
}: Props) {
  const [localViews, setLocalViews] = useState<SavedWorkView[]>(() =>
    loadSavedWorkViews(session),
  );
  const [sharedViews, setSharedViews] = useState<SharedWorkView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string | null>(null);
  const [sharedLoadError, setSharedLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saveTarget, setSaveTarget] = useState<SaveTarget>("shared");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onTenantDefaultResolvedRef = useRef(onTenantDefaultResolved);
  onTenantDefaultResolvedRef.current = onTenantDefaultResolved;

  useEffect(() => {
    setLocalViews(loadSavedWorkViews(session));
    setMessage(null);
    setError(null);
    let cancelled = false;
    setSharedLoadError(null);
    void (async () => {
      try {
        const payload = await fetchSharedWorkViews(session);
        if (cancelled) {
          return;
        }
        setSharedViews(payload.views);
        const resolved = resolveDefault(payload.views, payload.defaultViewId);
        setDefaultViewId(resolved?.viewId ?? null);
        onTenantDefaultResolvedRef.current(resolved);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSharedViews([]);
        setDefaultViewId(null);
        setSharedLoadError(errorMessage(err));
        onTenantDefaultResolvedRef.current(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const hint = useMemo(() => describeWorkSections(sections), [sections]);
  const defaultView = useMemo(
    () => resolveDefault(sharedViews, defaultViewId),
    [sharedViews, defaultViewId],
  );

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
      const nextViews = sharedViews.filter((v) => v.id !== id);
      const nextDefault = defaultViewId === id ? null : defaultViewId;
      setSharedViews(nextViews);
      setDefaultViewId(nextDefault);
      onTenantDefaultResolved(resolveDefault(nextViews, nextDefault));
      setMessage("Shared Work view removed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSetDefault(view: SharedWorkView) {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const id = await setTenantWorkDefault(session, view.id);
      setDefaultViewId(id);
      onTenantDefaultResolved(resolveDefault(sharedViews, id));
      setMessage(`Tenant default Work view set to “${view.name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClearDefault() {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await clearTenantWorkDefault(session);
      setDefaultViewId(null);
      onTenantDefaultResolved(null);
      setMessage("Tenant default Work view cleared.");
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
            {sharedViews.map((view) => {
              const isDefault = defaultViewId === view.id;
              return (
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
                    {isDefault ? " · default" : ""}
                  </button>
                  {!isDefault ? (
                    <button
                      type="button"
                      className="btn btn-secondary saved-view-delete"
                      disabled={locked}
                      aria-label={`Set ${view.name} as tenant default Work view`}
                      title="Set as tenant default"
                      onClick={() => void onSetDefault(view)}
                    >
                      ★
                    </button>
                  ) : null}
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
              );
            })}
          </ul>
        )}
      </div>

      {defaultView ? (
        <div className="saved-views-row">
          <span className="muted tiny" role="status">
            Tenant default: {defaultView.name}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onClick={() => void onClearDefault()}
          >
            Clear tenant default
          </button>
        </div>
      ) : null}

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
