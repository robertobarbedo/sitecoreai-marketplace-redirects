"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import {
  mdiCog,
  mdiDirections,
  mdiLoading,
  mdiMagnify,
  mdiPlay,
  mdiPlus,
} from "@mdi/js";

import { LEVEL_LABEL } from "@/components/redirects/badges";
import {
  EnvironmentBar,
  EnvironmentChooser,
} from "@/components/redirects/environment-picker";
import {
  ProgressDialog,
  type ProgressState,
} from "@/components/redirects/progress-dialog";
import { RedirectDialog } from "@/components/redirects/redirect-dialog";
import { RedirectTable } from "@/components/redirects/redirect-table";
import { SettingsPage } from "@/components/redirects/settings-page";
import { SitePicker, type SiteGroup } from "@/components/redirects/site-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LANGUAGE,
  PUBLISH_TEST_DELAYS_MS,
  TEST_CONCURRENCY,
} from "@/src/constants";
import { MarketplaceAuthProvider } from "@/src/lib/marketplace-auth/AuthProvider";
import type {
  LinkValue,
  ProgressStep,
  RedirectDraft,
  RedirectRow,
  RedirectSettings,
  TestLevel,
  TestResult,
  TestState,
} from "@/src/types/redirects";
import { idKey } from "@/src/utils/format";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import { loadPrefs, savePrefs } from "@/src/utils/prefs";
import { testRedirect } from "@/src/utils/redirect-test";
import {
  createRedirectItem,
  loadRedirects,
  normalizeRoute,
  publishAndWait,
  removeRedirect,
  resolveDestination,
  writeDestination,
  type SiteContext,
} from "@/src/utils/redirects";
import {
  DEFAULT_SETTINGS,
  getSiteSetup,
  loadSettings,
  saveSettings,
} from "@/src/utils/settings";
import {
  listChildren,
  listSites,
  queryItem,
  readEnvironments,
  resolveItemsById,
  type EnvironmentContext,
  type SiteInfo,
} from "@/src/utils/sitecore-graphql";
import {
  cleanBase,
  displayBase,
  redirectsRootPath,
  routeOf,
  siteLanguages,
  siteUrls,
} from "@/src/utils/urls";

interface ToastState {
  title: string;
  description: string;
  variant: "default" | "success" | "error" | "warning";
}

interface ScanState {
  running: boolean;
  finished: boolean;
  done: number;
  total: number;
}

const IDLE_SCAN: ScanState = { running: false, finished: false, done: 0, total: 0 };

const LEVELS: TestLevel[] = ["broken", "warning", "working"];

const LEVEL_TEXT: Record<TestLevel, string> = {
  broken: "text-danger-fg",
  warning: "text-[#953d00]",
  working: "text-success-fg",
  error: "text-on-surface-variant",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Signs the user in for the /api/test route. The provider reads `window`, so it
 * only mounts in the browser. Non-blocking: listing and editing redirects work
 * right away; only the live tests wait for sign-in.
 */
function AuthBoundary({
  appContext,
  children,
}: {
  appContext?: ApplicationContext;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{children}</>;
  return (
    <MarketplaceAuthProvider appContext={appContext} blocking={false}>
      {children}
    </MarketplaceAuthProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-surface-bright p-(--spacing-margin-page)">
      <div className="mx-auto max-w-[1280px] space-y-5">{children}</div>
    </main>
  );
}

export default function RedirectManager() {
  const { client, error, isInitialized } = useMarketplaceClient();

  /* --------------------------------------------------------------- state */

  const [appContext, setAppContext] = useState<ApplicationContext>();
  const [environments, setEnvironments] = useState<EnvironmentContext[]>([]);
  const [env, setEnv] = useState<EnvironmentContext | null>(null);
  // Which environment the sites and settings on screen belong to.
  const [envLoad, setEnvLoad] = useState<{
    id: string;
    error: string | null;
  } | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [settings, setSettings] = useState<RedirectSettings>(DEFAULT_SETTINGS);
  const [selection, setSelection] = useState({ siteName: "", language: "" });

  const [rows, setRows] = useState<RedirectRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [scan, setScan] = useState<ScanState>(IDLE_SCAN);
  const scanCancelRef = useRef(false);
  const [levelFilter, setLevelFilter] = useState<TestLevel | "all">("all");
  const [filterText, setFilterText] = useState("");
  const [page, setPage] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [view, setView] = useState<"list" | "settings">("list");
  const [settingsSite, setSettingsSite] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // null = closed; { row: null } = new redirect; { row } = edit
  const [editor, setEditor] = useState<{ row: RedirectRow | null } | null>(null);
  const [deleting, setDeleting] = useState<RedirectRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [flowRunning, setFlowRunning] = useState(false);
  // Identifies the save flow whose progress is on screen; closing the dialog
  // bumps it, which skips that flow's remaining test attempts.
  const flowRef = useRef(0);

  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback(
    (title: string, description: string, variant: ToastState["variant"]) =>
      setToast({ title, description, variant }),
    [],
  );

  /* ----------------------------------------------------------- bootstrap */

  const bootedRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || !client || bootedRef.current) return;
    bootedRef.current = true;
    let active = true;

    (async () => {
      try {
        const response = await client.query("application.context");
        if (!active) return;
        setAppContext(response.data as ApplicationContext);

        const available = readEnvironments(response.data);
        if (available.length === 0) {
          setBootError(
            "This app could not read an environment from the Marketplace host.",
          );
          return;
        }
        setEnvironments(available);

        const prefs = loadPrefs();
        setSelection({ siteName: prefs.siteName, language: prefs.language });
        // One environment (Full Screen): use it. Several (Standalone): the one
        // picked last time, otherwise the user is asked.
        setEnv(
          available.length === 1
            ? available[0]
            : (available.find((item) => item.id === prefs.environmentId) ?? null),
        );
      } catch (bootFailure) {
        if (active) setBootError(message(bootFailure));
      } finally {
        if (active) setBooting(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [isInitialized, client]);

  // Sites and settings of the environment in use; runs again on a switch.
  useEffect(() => {
    if (!client || !env) return;
    let active = true;

    (async () => {
      const [sitesResult, settingsResult] = await Promise.allSettled([
        listSites(client, env.liveContextId),
        loadSettings(client, env.contextId),
      ]);
      if (!active) return;

      setSites(sitesResult.status === "fulfilled" ? sitesResult.value : []);
      setSettings(
        settingsResult.status === "fulfilled"
          ? settingsResult.value
          : DEFAULT_SETTINGS,
      );
      setEnvLoad({
        id: env.id,
        error:
          sitesResult.status === "fulfilled"
            ? null
            : `Could not list the sites: ${message(sitesResult.reason)}`,
      });
    })();

    return () => {
      active = false;
    };
  }, [client, env]);

  /* ------------------------------------------------------------- derived */

  const groups = useMemo<SiteGroup[]>(
    () =>
      sites.map((site) => ({
        siteName: site.name,
        urls: siteUrls(site, getSiteSetup(settings, site.name), DEFAULT_LANGUAGE),
      })),
    [sites, settings],
  );

  const selectedUrl = useMemo(() => {
    const all = groups.flatMap((group) => group.urls);
    return (
      all.find(
        (url) =>
          url.siteName === selection.siteName &&
          url.language === selection.language,
      ) ??
      all.find((url) => url.siteName === selection.siteName) ??
      all[0] ??
      null
    );
  }, [groups, selection]);

  const site = useMemo(
    () => sites.find((candidate) => candidate.name === selectedUrl?.siteName),
    [sites, selectedUrl],
  );
  const setup = useMemo(
    () => (site ? getSiteSetup(settings, site.name) : null),
    [settings, site],
  );
  const language = selectedUrl?.language ?? DEFAULT_LANGUAGE;
  const base = selectedUrl?.base ?? "";
  const vercelBypass = setup?.vercelBypass ?? null;

  const siteContext = useMemo<SiteContext | null>(
    () =>
      site && setup
        ? { setup, language, rootPath: redirectsRootPath(site, setup) }
        : null,
    [site, setup, language],
  );

  const allLanguages = useMemo(
    () => (site ? siteLanguages(site, DEFAULT_LANGUAGE) : [language]),
    [site, language],
  );

  /* ---------------------------------------------------------------- list */

  // Changes whenever a different set of redirects should be on screen.
  const listKey = siteContext
    ? [
        env?.id,
        site?.name,
        siteContext.language,
        siteContext.rootPath,
        siteContext.setup.templateId,
        siteContext.setup.fieldName,
      ].join("|")
    : "";
  const [reloadToken, setReloadToken] = useState(0);
  const lastListKeyRef = useRef("");

  useEffect(() => {
    if (!client || !env || !siteContext || !listKey) return;

    if (lastListKeyRef.current !== listKey) {
      lastListKeyRef.current = listKey;
      scanCancelRef.current = true;
      setRows([]);
      setTests({});
      setScan(IDLE_SCAN);
      setLevelFilter("all");
      setExpandedKey(null);
      setPage(0);
    }

    let active = true;
    setLoading(true);
    setLoadError(null);

    loadRedirects(client, env.contextId, siteContext)
      .then((result) => {
        if (!active) return;
        setRows(result.rows);
        setTruncated(result.truncated);
      })
      .catch((loadFailure) => {
        if (active) setLoadError(message(loadFailure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // siteContext is covered by listKey; depending on the object would reload
    // on every settings re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, env, listKey, reloadToken]);

  const counts = useMemo(() => {
    const result: Record<TestLevel, number> = {
      working: 0,
      warning: 0,
      broken: 0,
      error: 0,
    };
    for (const row of rows) {
      const state = tests[row.key];
      if (typeof state === "object") result[state.level] += 1;
    }
    return result;
  }, [rows, tests]);

  const testedCount =
    counts.working + counts.warning + counts.broken + counts.error;

  const filteredRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter((row) => {
      if (levelFilter !== "all") {
        const state = tests[row.key];
        if (typeof state !== "object" || state.level !== levelFilter) return false;
      }
      if (!needle) return true;
      return [row.from, row.targetName, row.targetRoute, row.link.url]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, tests, levelFilter, filterText]);

  /* --------------------------------------------------------------- tests */

  const testOne = useCallback(
    async (row: RedirectRow) => {
      setTests((current) => ({ ...current, [row.key]: "running" }));
      const result = await testRedirect(row, base, vercelBypass);
      setTests((current) => ({ ...current, [row.key]: result }));
      if (result.level !== "working") setExpandedKey(row.key);
    },
    [base, vercelBypass],
  );

  const testAll = useCallback(async () => {
    const targets = rows;
    if (targets.length === 0) return;

    scanCancelRef.current = false;
    setLevelFilter("all");
    setTests((current) => ({
      ...current,
      ...Object.fromEntries(targets.map((row) => [row.key, "queued" as const])),
    }));
    setScan({ running: true, finished: false, done: 0, total: targets.length });

    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        if (scanCancelRef.current) return;
        const index = next;
        next += 1;
        if (index >= targets.length) return;
        const row = targets[index];
        setTests((current) => ({ ...current, [row.key]: "running" }));
        const result = await testRedirect(row, base, vercelBypass);
        if (scanCancelRef.current) return;
        setTests((current) => ({ ...current, [row.key]: result }));
        done += 1;
        setScan((current) => ({ ...current, done }));
      }
    };
    await Promise.all(Array.from({ length: TEST_CONCURRENCY }, worker));

    // A stopped scan leaves rows marked queued or running: clear those.
    setTests((current) => {
      const cleaned = { ...current };
      for (const row of targets) {
        if (typeof cleaned[row.key] === "string") delete cleaned[row.key];
      }
      return cleaned;
    });
    setScan((current) => ({ ...current, running: false, finished: true }));
  }, [rows, base, vercelBypass]);

  const stopScan = () => {
    scanCancelRef.current = true;
  };

  /* ---------------------------------------------------------------- save */

  /** A table row for an item that was just written, without waiting for the index. */
  const buildRow = useCallback(
    async (
      item: { itemId: string; name: string; path: string; version?: number },
      link: LinkValue,
      context: SiteContext,
      contextId: string,
    ): Promise<RedirectRow> => {
      let target: { name: string; path: string } | null = null;
      if (client && link.kind === "internal") {
        try {
          const resolved = await resolveItemsById(
            client,
            contextId,
            [link.id],
            context.language,
          );
          target = resolved.get(idKey(link.id)) ?? null;
        } catch {
          // Shown as a missing destination; the next reload corrects it.
        }
      }
      return {
        key: `${idKey(item.itemId)}|${context.language}`,
        itemId: item.itemId,
        name: item.name,
        path: item.path,
        language: context.language,
        version: item.version ?? 1,
        from: routeOf(item.path, context.rootPath) ?? item.path,
        link,
        targetPath: target?.path ?? null,
        targetName: target?.name ?? "",
        targetRoute: target ? (routeOf(target.path, context.rootPath) ?? "") : "",
        updated: new Date().toISOString(),
        updatedBy: "",
      };
    },
    [client],
  );

  const runSave = useCallback(
    async (draft: RedirectDraft, editing: RedirectRow | null) => {
      if (!client || !env || !siteContext) return;

      const context = siteContext;
      const contextId = env.contextId;
      const flowId = flowRef.current + 1;
      flowRef.current = flowId;
      const closed = () => flowRef.current !== flowId;

      const route = editing ? editing.from : normalizeRoute(draft.from, base);
      const others = draft.allLanguages
        ? allLanguages.filter((code) => code !== context.language)
        : [];
      const attempts = PUBLISH_TEST_DELAYS_MS.length;

      const steps: ProgressStep[] = [
        {
          id: "save",
          label: editing ? "Save the redirect" : "Create the redirect",
          status: "running",
          detail: "",
        },
      ];
      if (others.length > 0) {
        steps.push({
          id: "languages",
          label: `Write the other ${others.length} ${others.length === 1 ? "language" : "languages"}`,
          status: "pending",
          detail: "",
        });
      }
      if (draft.publish) {
        steps.push(
          { id: "publish", label: "Publish to the live site", status: "pending", detail: "" },
          { id: "test", label: "Test the live URL", status: "pending", detail: "" },
        );
      }

      const patch = (id: string, change: Partial<ProgressStep>) =>
        setProgress((current) =>
          current && !closed()
            ? {
                ...current,
                steps: current.steps.map((step) =>
                  step.id === id ? { ...step, ...change } : step,
                ),
              }
            : current,
        );
      const finish = (result: TestResult | null) => {
        setProgress((current) =>
          current && !closed() ? { ...current, finished: true, result } : current,
        );
        setFlowRunning(false);
      };

      setEditor(null);
      setFlowRunning(true);
      setProgress({
        title: editing ? "Saving redirect" : "Creating redirect",
        subtitle: `${base ? displayBase(base).replace(/\/$/, "") : ""}${route}`,
        steps,
        finished: false,
        result: null,
      });

      // 1 · the item and its destination in the language in context
      let row: RedirectRow;
      try {
        const item =
          editing ??
          (await createRedirectItem(client, contextId, context, route));
        const failures = await writeDestination(
          client,
          contextId,
          context,
          item.itemId,
          draft.link,
          [context.language],
        );
        if (failures.length > 0) throw new Error(failures[0].message);

        row = await buildRow(item, draft.link, context, contextId);
        setRows((current) =>
          [...current.filter((existing) => existing.key !== row.key), row].sort(
            (a, b) => a.from.localeCompare(b.from),
          ),
        );
        setTests((current) => {
          const cleaned = { ...current };
          delete cleaned[row.key];
          return cleaned;
        });
        patch("save", { status: "done", detail: item.path });
      } catch (saveFailure) {
        patch("save", { status: "failed", detail: message(saveFailure) });
        finish(null);
        return;
      }

      // 2 · the same destination in every other language
      if (others.length > 0) {
        patch("languages", { status: "running" });
        const failures = await writeDestination(
          client,
          contextId,
          context,
          row.itemId,
          draft.link,
          others,
        );
        patch(
          "languages",
          failures.length > 0
            ? {
                status: "failed",
                detail: `Not written for ${failures.map((f) => f.language).join(", ")}: ${failures[0].message}`,
              }
            : { status: "done", detail: others.join(", ") },
        );
      }

      if (!draft.publish) {
        finish(null);
        return;
      }

      // 3 · publish
      patch("publish", { status: "running", detail: "Sending to Experience Edge" });
      try {
        const outcome = await publishAndWait(
          client,
          contextId,
          row.path,
          [context.language, ...others],
          closed,
        );
        patch("publish", {
          status: "done",
          detail:
            outcome === "done"
              ? "Published"
              : outcome === "timeout"
                ? "Still publishing; testing anyway"
                : "Publish requested",
        });
      } catch (publishFailure) {
        patch("publish", { status: "failed", detail: message(publishFailure) });
        patch("test", { status: "failed", detail: "Skipped: nothing was published" });
        finish(null);
        return;
      }

      // 4 · test, repeated because the first attempts can hit a cache
      let last: TestResult | null = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (closed()) break;
        const label = `Attempt ${attempt + 1} of ${attempts}`;
        patch("test", {
          status: "running",
          detail: last
            ? `${label}: last answer was "${last.note}", waiting to retry`
            : `${label}: waiting for the live site to update`,
        });
        await sleep(PUBLISH_TEST_DELAYS_MS[attempt]);
        if (closed()) break;
        patch("test", { detail: `${label}: requesting the URL` });
        last = await testRedirect(row, base, vercelBypass);
        if (last.level !== "broken") break;
      }

      if (last) {
        const result = last;
        setTests((current) => ({ ...current, [row.key]: result }));
        patch("test", {
          status: result.level === "working" || result.level === "warning" ? "done" : "failed",
          detail: result.note,
        });
      }
      finish(last);
    },
    [client, env, siteContext, base, vercelBypass, allLanguages, buildRow],
  );

  const switchEnvironment = (next: EnvironmentContext) => {
    if (next.id === env?.id) return;
    // Nothing of the previous environment may stay on screen.
    flowRef.current += 1;
    scanCancelRef.current = true;
    lastListKeyRef.current = "";
    setProgress(null);
    setEditor(null);
    setDeleting(null);
    setView("list");
    setSites([]);
    setSettings(DEFAULT_SETTINGS);
    setRows([]);
    setTests({});
    setScan(IDLE_SCAN);
    setEnv(next);
    savePrefs({ environmentId: next.id });
  };

  const closeProgress = () => {
    flowRef.current += 1;
    setProgress(null);
  };

  const pointTo = useCallback(
    async (row: RedirectRow, finalUrl: string) => {
      if (!client || !env || !siteContext || !setup) return;
      const bare = cleanBase(finalUrl.replace(/[?#].*$/, ""));
      let link: LinkValue = { kind: "external", id: "", url: finalUrl };
      if (base && bare.toLowerCase().startsWith(base.toLowerCase())) {
        const item = await resolveDestination(
          client,
          env.contextId,
          siteContext,
          bare.slice(base.length) || "/",
        ).catch(() => null);
        if (item) link = { kind: "internal", id: item.itemId, url: "" };
      }
      void runSave(
        { from: row.from, link, allLanguages: false, publish: setup.publishOnSave },
        row,
      );
    },
    [client, env, siteContext, setup, base, runSave],
  );

  /* -------------------------------------------------------------- delete */

  const confirmDelete = async () => {
    if (!client || !env || !deleting || !setup) return;
    const row = deleting;
    setIsDeleting(true);
    try {
      await removeRedirect(
        client,
        env.contextId,
        row,
        setup.publishOnSave,
        allLanguages,
      );
      setRows((current) => current.filter((existing) => existing.key !== row.key));
      showToast(
        "Redirect deleted",
        setup.publishOnSave
          ? `${row.from} was unpublished and moved to the recycle bin.`
          : `${row.from} was moved to the recycle bin. It stays live until its parent page is published.`,
        "success",
      );
    } catch (deleteFailure) {
      showToast("Could not delete the redirect", message(deleteFailure), "error");
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  };

  /* ------------------------------------------------------------ settings */

  const openSettings = (siteName: string) => {
    setSettingsSite(siteName);
    setView("settings");
  };

  const persistSettings = async (next: RedirectSettings) => {
    if (!client || !env) return;
    setIsSavingSettings(true);
    try {
      setSettings(await saveSettings(client, env.contextId, next));
      setView("list");
      showToast("Setup saved", "The site setup was updated.", "success");
    } catch (settingsFailure) {
      showToast("Could not save the setup", message(settingsFailure), "error");
    } finally {
      setIsSavingSettings(false);
    }
  };

  /* -------------------------------------------------------------- export */

  const exportCsv = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [
      ["From", "Redirects to", "Type", "Language", "Test result", "Note"]
        .map(quote)
        .join(","),
      ...filteredRows.map((row) => {
        const state = tests[row.key];
        const result = typeof state === "object" ? state : null;
        return [
          row.from,
          row.link.kind === "external"
            ? row.link.url
            : row.targetRoute || row.targetPath || "",
          row.link.kind,
          row.language,
          result ? LEVEL_LABEL[result.level] : "",
          result?.note ?? "",
        ]
          .map(quote)
          .join(",");
      }),
    ];
    const blob = new Blob([`﻿${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `redirects-${site?.name ?? "site"}-${language}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /* -------------------------------------------------------------- render */

  if (error) {
    return (
      <Shell>
        <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
          <h2 className="mb-1 font-bold">Could not connect to SitecoreAI</h2>
          <p className="text-sm">{error.message}</p>
        </div>
      </Shell>
    );
  }

  if (!isInitialized || booting) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-3 py-32 text-text-subtle">
          <Icon path={mdiLoading} size={1} className="animate-spin" />
          <span>Connecting to Sitecore&hellip;</span>
        </div>
      </Shell>
    );
  }

  if (!bootError && !env && environments.length > 1) {
    return (
      <Shell>
        <EnvironmentChooser
          environments={environments}
          onSelect={switchEnvironment}
        />
      </Shell>
    );
  }

  if (bootError || !env) {
    return (
      <Shell>
        <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
          <h2 className="mb-1 font-bold">No environment access</h2>
          <p className="text-sm">
            {bootError ??
              "The Marketplace host did not report an environment this app can read."}
          </p>
        </div>
      </Shell>
    );
  }

  if (envLoad?.id !== env.id) {
    return (
      <Shell>
        <EnvironmentBar
          environments={environments}
          selected={env}
          onSelect={switchEnvironment}
        />
        <div className="flex items-center justify-center gap-3 py-32 text-text-subtle">
          <Icon path={mdiLoading} size={1} className="animate-spin" />
          <span>Loading {env.label}&hellip;</span>
        </div>
      </Shell>
    );
  }

  if (envLoad.error) {
    return (
      <Shell>
        <EnvironmentBar
          environments={environments}
          selected={env}
          onSelect={switchEnvironment}
        />
        <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
          <h2 className="mb-1 font-bold">Could not open {env.label}</h2>
          <p className="text-sm">{envLoad.error}</p>
        </div>
      </Shell>
    );
  }

  const busy = flowRunning || isDeleting || scan.running;
  const showEmpty = !loading && !loadError && rows.length === 0 && site && setup;

  return (
    <AuthBoundary appContext={appContext}>
      <ToastProvider swipeDirection="right">
        <Shell>
          <EnvironmentBar
            environments={environments}
            selected={env}
            disabled={busy || isSavingSettings}
            onSelect={switchEnvironment}
          />
          {view === "settings" ? (
            <SettingsPage
              sites={sites}
              settings={settings}
              initialSite={settingsSite || site?.name || ""}
              isSaving={isSavingSettings}
              onCheckTemplate={(idOrPath) =>
                queryItem(client!, env.contextId, idOrPath, DEFAULT_LANGUAGE)
              }
              onSave={(next) => void persistSettings(next)}
              onBack={() => setView("list")}
            />
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/arrow-fat-lines-right-duotone.svg"
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0"
                  />
                  <div>
                    <h1 className="text-lg font-bold text-on-surface">
                      Redirect Manager
                    </h1>
                    <p className="text-[11px] text-text-subtle">
                      Manage redirect items for your SXA sites
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SitePicker
                    groups={groups}
                    selected={selectedUrl}
                    onSelect={(url) => {
                      const next = { siteName: url.siteName, language: url.language };
                      setSelection(next);
                      savePrefs(next);
                    }}
                    onConfigure={openSettings}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Settings"
                    title="Settings"
                    onClick={() => openSettings(site?.name ?? "")}
                  >
                    <Icon path={mdiCog} size={0.85} />
                  </Button>
                </div>
              </header>

              {!site || !setup ? (
                <div className="rounded-xl border border-border-muted bg-white py-16 text-center text-text-subtle">
                  This environment has no sites.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-muted bg-white p-4">
                    <label className="flex h-10 min-w-0 flex-[1_1_260px] items-center gap-2 rounded-xl border border-border-muted px-3 text-text-subtle focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/50">
                      <Icon path={mdiMagnify} size={0.7} />
                      <input
                        type="search"
                        aria-label="Search redirects"
                        placeholder="Search by path or destination"
                        value={filterText}
                        onChange={(event) => {
                          setFilterText(event.target.value);
                          setPage(0);
                        }}
                        className="min-w-0 flex-1 bg-transparent text-on-surface outline-none placeholder:text-text-subtle"
                      />
                    </label>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy || loading || rows.length === 0}
                        onClick={() => void testAll()}
                      >
                        <Icon path={mdiPlay} size={0.7} />
                        Test all
                      </Button>
                      <Button
                        variant="outline"
                        disabled={filteredRows.length === 0}
                        onClick={exportCsv}
                      >
                        Export
                      </Button>
                      <Button
                        variant="outline"
                        className="border-primary text-primary-fg"
                        disabled={busy || loading}
                        onClick={() => setEditor({ row: null })}
                      >
                        <Icon path={mdiPlus} size={0.7} />
                        New redirect
                      </Button>
                    </div>
                  </div>

                  {scan.running && (
                    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border-muted bg-white p-4">
                      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
                        <div>
                          <span className="font-semibold">Testing redirects</span>{" "}
                          <span className="text-xs text-text-subtle">
                            · {scan.done} of {scan.total} · requesting each URL
                            on {displayBase(base)}
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={scan.total}
                          aria-valuenow={scan.done}
                          className="h-2 overflow-hidden rounded-full bg-surface-container"
                        >
                          <div
                            className="h-full bg-primary transition-all"
                            style={{
                              width: `${scan.total ? (scan.done / scan.total) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={stopScan}>
                        Stop
                      </Button>
                    </div>
                  )}

                  {scan.finished && !scan.running && testedCount > 0 && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-muted bg-white p-4">
                      <div className="min-w-0 flex-[1_1_240px]">
                        <div className="font-semibold">
                          Test finished
                        </div>
                        <div className="text-xs text-text-subtle">
                          {testedCount} of {rows.length} tested on{" "}
                          {displayBase(base)}
                          {counts.error > 0 &&
                            ` · ${counts.error} could not be tested`}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          aria-pressed={levelFilter === "all"}
                          onClick={() => {
                            setLevelFilter("all");
                            setPage(0);
                          }}
                          className={cn(
                            "h-8 rounded-xl border px-3 text-xs font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50",
                            levelFilter === "all"
                              ? "border-primary bg-primary-bg text-primary-fg"
                              : "border-border-muted bg-white text-on-surface-variant hover:bg-surface-container",
                          )}
                        >
                          All · {rows.length}
                        </button>
                        {LEVELS.map((level) => (
                          <button
                            key={level}
                            type="button"
                            aria-pressed={levelFilter === level}
                            onClick={() => {
                              setLevelFilter(level);
                              setPage(0);
                            }}
                            className={cn(
                              "h-8 rounded-xl border px-3 text-xs font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50",
                              levelFilter === level
                                ? "border-primary bg-primary-bg"
                                : "border-border-muted bg-white hover:bg-surface-container",
                              LEVEL_TEXT[level],
                            )}
                          >
                            {LEVEL_LABEL[level]} · {counts[level]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadError && (
                    <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
                      <h2 className="mb-1 font-bold">
                        Could not read the redirects
                      </h2>
                      <p className="text-sm">{loadError}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => setReloadToken((token) => token + 1)}
                      >
                        Try again
                      </Button>
                    </div>
                  )}

                  {truncated && (
                    <div className="rounded-xl border border-[#ba5200] bg-[#ffe6bd] p-4 text-[#953d00]">
                      This site has more redirects than the app reads in one
                      go, so the list is incomplete.
                    </div>
                  )}

                  {loading && rows.length === 0 && (
                    <div className="flex items-center justify-center gap-3 rounded-xl border border-border-muted bg-white py-16 text-text-subtle">
                      <Icon path={mdiLoading} size={1} className="animate-spin" />
                      <span>Reading redirects&hellip;</span>
                    </div>
                  )}

                  {showEmpty && (
                    <div className="flex flex-col items-center gap-4 rounded-xl border border-border-muted bg-white px-6 py-14 text-center">
                      <div className="flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
                        <Icon path={mdiDirections} size={1} />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold">
                          No redirects found on this site
                        </h2>
                        <p className="mx-auto mt-1.5 max-w-[520px] text-text-subtle">
                          The app looked for items that use the template below.
                          If this site uses its own redirect template, change
                          it in the site setup.
                        </p>
                      </div>
                      <dl className="grid w-full max-w-[520px] grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-xl border border-border-muted bg-surface p-4 text-left">
                        <dt className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                          Template
                        </dt>
                        <dd className="truncate font-mono text-xs">
                          {setup.templatePath || setup.templateId}
                        </dd>
                        <dt className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                          Field
                        </dt>
                        <dd className="font-mono text-xs">{setup.fieldName}</dd>
                        <dt className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                          Under
                        </dt>
                        <dd className="truncate font-mono text-xs">
                          {siteContext?.rootPath}
                        </dd>
                      </dl>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button onClick={() => setEditor({ row: null })}>
                          New redirect
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => openSettings(site.name)}
                        >
                          Open site setup
                        </Button>
                      </div>
                    </div>
                  )}

                  {rows.length > 0 &&
                    (filteredRows.length === 0 ? (
                      <div className="rounded-xl border border-border-muted bg-white py-16 text-center text-text-subtle">
                        No redirect matches the search or filter.
                      </div>
                    ) : (
                      <RedirectTable
                        rows={filteredRows}
                        page={page}
                        onPageChange={setPage}
                        tests={tests}
                        expandedKey={expandedKey}
                        onToggleDetails={(key) =>
                          setExpandedKey((current) => (current === key ? null : key))
                        }
                        onTest={(row) => void testOne(row)}
                        onEdit={(row) => setEditor({ row })}
                        onDelete={setDeleting}
                        onPointTo={(row, url) => void pointTo(row, url)}
                        busy={busy}
                        base={base}
                      />
                    ))}
                </>
              )}
            </>
          )}
        </Shell>

        <RedirectDialog
          open={editor !== null}
          row={editor?.row ?? null}
          siteName={site?.name ?? ""}
          base={base}
          language={language}
          languageCount={allLanguages.length}
          defaultPublish={setup?.publishOnSave ?? true}
          treeRootPath={site ? `${site.rootPath}${site.startItem}` : ""}
          routeRootPath={siteContext?.rootPath ?? ""}
          onLoadChildren={(path) =>
            client && env
              ? listChildren(client, env.contextId, path, language)
              : Promise.resolve([])
          }
          onResolve={(input) =>
            client && siteContext
              ? resolveDestination(client, env.contextId, siteContext, input)
              : Promise.resolve(null)
          }
          onSubmit={(draft) => void runSave(draft, editor?.row ?? null)}
          onClose={() => setEditor(null)}
        />

        <ProgressDialog state={progress} onClose={closeProgress} />

        <Dialog
          open={deleting !== null}
          onOpenChange={(open) => !open && !isDeleting && setDeleting(null)}
        >
          <DialogContent className="max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">
                Delete this redirect?
              </DialogTitle>
              <DialogDescription className="break-all font-mono text-xs text-text-subtle">
                {displayBase(base).replace(/\/$/, "")}
                {deleting?.from}
              </DialogDescription>
            </DialogHeader>
            <p>
              The redirect item is removed in every language and moved to the
              recycle bin.{" "}
              {setup?.publishOnSave
                ? "It is unpublished first, so the URL stops redirecting on the live site."
                : "It stays live until its parent page is published."}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={isDeleting}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                colorScheme="danger"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
              >
                {isDeleting && (
                  <Icon path={mdiLoading} size={0.7} className="animate-spin" />
                )}
                Delete redirect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {toast && (
          <Toast
            open
            variant={toast.variant}
            duration={5000}
            onOpenChange={(open) => !open && setToast(null)}
          >
            <div className="min-w-0">
              <ToastTitle>{toast.title}</ToastTitle>
              <ToastDescription>{toast.description}</ToastDescription>
            </div>
          </Toast>
        )}
        <ToastViewport />
      </ToastProvider>
    </AuthBoundary>
  );
}
