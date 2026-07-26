import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  fetchSharedFindingViews,
  type SharedFindingView,
} from "../api/findings";
import type { OperatorSession } from "../auth/session";
import {
  buildOperatorCommands,
  commandTargetPath,
  filterOperatorCommands,
  type OperatorCommand,
} from "./commands";

interface Props {
  session: OperatorSession;
}

export function CommandBar({ session }: Props) {
  const navigate = useNavigate();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sharedViews, setSharedViews] = useState<SharedFindingView[]>([]);

  const commands = useMemo(
    () =>
      open
        ? buildOperatorCommands({ session, sharedViews })
        : [],
    [open, session, sharedViews],
  );
  const matches = useMemo(
    () => filterOperatorCommands(commands, query),
    [commands, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const openBar = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    let cancelled = false;
    void (async () => {
      try {
        const views = await fetchSharedFindingViews(session);
        if (!cancelled) {
          setSharedViews(views);
        }
      } catch {
        if (!cancelled) {
          setSharedViews([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          close();
        } else {
          openBar();
        }
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openBar, close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      if (event.target instanceof Node && !root.contains(event.target)) {
        close();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  function runCommand(command: OperatorCommand) {
    navigate(commandTargetPath(command));
    close();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) =>
        matches.length === 0 ? 0 : Math.min(i + 1, matches.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = matches[activeIndex];
      if (command) {
        runCommand(command);
      }
    }
  }

  return (
    <div className="command-bar" ref={rootRef}>
      <button
        type="button"
        className="btn btn-secondary command-bar-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) {
            close();
          } else {
            openBar();
          }
        }}
      >
        Jump to…
        <span className="muted tiny command-bar-hint">Ctrl/⌘ K</span>
      </button>

      {open ? (
        <div
          className="command-bar-panel"
          id={panelId}
          role="dialog"
          aria-label="Jump to destination or findings filter"
        >
          <label className="command-bar-search">
            <span className="visually-hidden">Filter actions</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Findings, Agents, saved views…"
              aria-label="Filter actions"
              aria-autocomplete="list"
              aria-controls={`${panelId}-list`}
              aria-activedescendant={
                matches[activeIndex]
                  ? `${panelId}-opt-${matches[activeIndex].id}`
                  : undefined
              }
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
          </label>

          {matches.length === 0 ? (
            <p className="empty tiny" role="status">
              No matching actions.
            </p>
          ) : (
            <ul
              className="command-bar-list"
              id={`${panelId}-list`}
              role="listbox"
              aria-label="Actions"
            >
              {matches.map((command, index) => {
                const active = index === activeIndex;
                return (
                  <li key={command.id} role="presentation">
                    <button
                      type="button"
                      id={`${panelId}-opt-${command.id}`}
                      role="option"
                      aria-selected={active}
                      className={
                        active
                          ? "command-bar-option is-active"
                          : "command-bar-option"
                      }
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runCommand(command)}
                    >
                      <span>{command.label}</span>
                      <span className="muted tiny">
                        {command.kind === "nav"
                          ? "Navigate"
                          : command.kind === "saved-view"
                            ? command.scope === "shared"
                              ? "Shared view"
                              : "Local view"
                            : "Filter"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
