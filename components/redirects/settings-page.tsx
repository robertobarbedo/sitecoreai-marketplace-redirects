"use client";

import { useMemo, useState } from "react";
import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCheck,
  mdiLoading,
  mdiShieldCheckOutline,
} from "@mdi/js";

import { Tag } from "@/components/redirects/badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import { DEFAULT_LANGUAGE } from "@/src/constants";
import { authedFetch } from "@/src/lib/marketplace-auth/authedFetch";
import type {
  RedirectSettings,
  SiteSetup,
  VercelBypass,
} from "@/src/types/redirects";
import {
  DEFAULT_SITE_SETUP,
  getSiteSetup,
  usesSxaDefault,
} from "@/src/utils/settings";
import type { SitecoreItemRef, SiteInfo } from "@/src/utils/sitecore-graphql";
import {
  cleanBase,
  detectedBase,
  displayBase,
  redirectsRootPath,
  sameHosts,
  siteHosts,
  siteLanguages,
} from "@/src/utils/urls";

type SetupTab = "general" | "vercel";

const TABS: [SetupTab, string][] = [
  ["general", "General"],
  ["vercel", "Vercel"],
];

/** Seals a typed bypass secret on the server; only the sealed form comes back. */
async function sealVercelSecret(
  secret: string,
  hosts: string[],
): Promise<VercelBypass> {
  const response = await authedFetch("/api/vercel-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, hosts }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    sealed?: string;
    hosts?: string[];
    error?: string;
  };
  if (!response.ok || !data.sealed || !data.hosts) {
    throw new Error(
      data.error ||
        `The app could not store the secret (${response.status}). Check the app's sign-in configuration.`,
    );
  }
  return { sealed: data.sealed, hosts: data.hosts };
}

const LABEL = "text-xs font-bold uppercase tracking-wider";
const HELP = "text-xs text-text-subtle";
const TEXT_INPUT =
  "h-10 w-full min-w-0 rounded-xl border border-border-muted bg-white px-3 font-mono text-[13px] text-on-surface outline-none placeholder:text-text-subtle focus:border-primary focus:ring-[3px] focus:ring-primary/50";

type TemplateCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; name: string }
  | { status: "missing" };

/** Only what differs from the SXA defaults is stored for a site. */
function toStored(setup: SiteSetup): Partial<SiteSetup> | null {
  const urls = Object.fromEntries(
    Object.entries(setup.urls)
      .map(([language, url]) => [language, cleanBase(url)] as const)
      .filter(([, url]) => url),
  );
  const isDefault =
    usesSxaDefault(setup) &&
    !setup.rootPath.trim() &&
    setup.publishOnSave === DEFAULT_SITE_SETUP.publishOnSave &&
    setup.allowChains === DEFAULT_SITE_SETUP.allowChains &&
    !setup.vercelBypass &&
    Object.keys(urls).length === 0;
  return isDefault ? null : { ...setup, rootPath: setup.rootPath.trim(), urls };
}

/**
 * Per-site setup, opened from the cog. Every site starts on the standard SXA
 * redirect template; this screen is only needed for sites that differ, or to
 * correct a site's live URLs.
 */
export function SettingsPage({
  sites,
  settings,
  initialSite,
  isSaving,
  onCheckTemplate,
  onSave,
  onBack,
}: {
  sites: SiteInfo[];
  settings: RedirectSettings;
  initialSite: string;
  isSaving: boolean;
  onCheckTemplate: (idOrPath: string) => Promise<SitecoreItemRef | null>;
  onSave: (next: RedirectSettings) => void;
  onBack: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, SiteSetup>>(() =>
    Object.fromEntries(
      sites.map((site) => [site.name, getSiteSetup(settings, site.name)]),
    ),
  );
  const [siteName, setSiteName] = useState(
    sites.some((site) => site.name === initialSite)
      ? initialSite
      : (sites[0]?.name ?? ""),
  );
  // What is typed in the template box, per site, until it is checked.
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>(
    {},
  );
  const [templateCheck, setTemplateCheck] = useState<TemplateCheck>({
    status: "idle",
  });
  const [tab, setTab] = useState<SetupTab>("general");
  // Bypass secrets typed per site, sealed on Save. A key present means the
  // input is open (no secret yet, or replacing the saved one).
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [isSealing, setIsSealing] = useState(false);
  const [secretError, setSecretError] = useState("");
  const busy = isSaving || isSealing;

  const site = useMemo(
    () => sites.find((candidate) => candidate.name === siteName),
    [sites, siteName],
  );
  const draft = drafts[siteName];

  const update = (patch: Partial<SiteSetup>) =>
    setDrafts((current) => ({
      ...current,
      [siteName]: { ...current[siteName], ...patch },
    }));

  if (!site || !draft) {
    return (
      <div className="rounded-xl border border-border-muted bg-white py-16 text-center text-text-subtle">
        This environment has no sites to set up.
        <div className="mt-4">
          <Button variant="outline" onClick={onBack}>
            Back to redirects
          </Button>
        </div>
      </div>
    );
  }

  const templateInput =
    templateInputs[siteName] ?? (draft.templatePath || draft.templateId);

  const checkTemplate = async (): Promise<boolean> => {
    const value = templateInput.trim();
    if (!value) {
      setTemplateCheck({ status: "missing" });
      return false;
    }
    setTemplateCheck({ status: "checking" });
    try {
      const item = await onCheckTemplate(value);
      if (!item) {
        setTemplateCheck({ status: "missing" });
        return false;
      }
      update({
        templateId: item.itemId,
        templatePath: item.path,
        templateName: item.name,
      });
      setTemplateInputs((current) => ({ ...current, [siteName]: item.path }));
      setTemplateCheck({ status: "found", name: item.name });
      return true;
    } catch {
      setTemplateCheck({ status: "missing" });
      return false;
    }
  };

  const save = async () => {
    // A template typed but not checked yet is checked before saving.
    const typed = templateInputs[siteName];
    if (
      typed !== undefined &&
      typed.trim() !== draft.templatePath &&
      typed.trim() !== draft.templateId &&
      !(await checkTemplate())
    ) {
      return;
    }
    // Seal every typed bypass secret first; stop on the first failure and
    // show it on that site's Vercel tab.
    const next = { ...drafts };
    setSecretError("");
    setIsSealing(true);
    try {
      for (const [name, typed] of Object.entries(secretInputs)) {
        const secret = typed.trim();
        const candidate = sites.find((s) => s.name === name);
        if (!secret || !candidate || !next[name]) continue;
        try {
          const hosts = siteHosts(candidate, next[name], DEFAULT_LANGUAGE);
          if (hosts.length === 0) {
            throw new Error(
              "This site has no live URL. Add one on the General tab first: the secret is only sent to the site's own hosts.",
            );
          }
          next[name] = {
            ...next[name],
            vercelBypass: await sealVercelSecret(secret, hosts),
          };
        } catch (sealFailure) {
          setSiteName(name);
          setTab("vercel");
          setSecretError(
            sealFailure instanceof Error
              ? sealFailure.message
              : String(sealFailure),
          );
          return;
        }
      }
    } finally {
      setIsSealing(false);
    }
    setDrafts(next);
    setSecretInputs({});

    const stored: Record<string, Partial<SiteSetup>> = {};
    for (const [name, setup] of Object.entries(next)) {
      const value = toStored(setup);
      if (value) stored[name] = value;
    }
    onSave({ ...settings, sites: stored });
  };

  const reset = () => {
    update({
      templateId: DEFAULT_SITE_SETUP.templateId,
      templatePath: DEFAULT_SITE_SETUP.templatePath,
      templateName: DEFAULT_SITE_SETUP.templateName,
      fieldName: DEFAULT_SITE_SETUP.fieldName,
    });
    setTemplateInputs((current) => ({
      ...current,
      [siteName]: DEFAULT_SITE_SETUP.templatePath,
    }));
    setTemplateCheck({ status: "idle" });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <Icon path={mdiArrowLeft} size={0.7} />
          Back to redirects
        </Button>
        <div>
          <h1 className="text-lg font-bold text-on-surface">Settings</h1>
          <p className="text-[11px] text-text-subtle">
            Every site starts on the standard SXA redirect template. Change it
            only for sites that use their own.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <nav
          aria-label="Sites"
          className="flex w-full flex-col gap-0.5 rounded-xl border border-border-muted bg-white p-2 md:w-[280px]"
        >
          <div className="px-2 pb-1.5 pt-2 text-xs font-bold uppercase tracking-wider text-text-subtle">
            Sites
          </div>
          {sites.map((candidate) => {
            const setup = drafts[candidate.name];
            const isDefault = setup ? usesSxaDefault(setup) : true;
            return (
              <button
                key={candidate.name}
                type="button"
                aria-current={candidate.name === siteName ? "true" : undefined}
                onClick={() => {
                  setSiteName(candidate.name);
                  setTemplateCheck({ status: "idle" });
                  setSecretError("");
                }}
                className={cn(
                  "flex min-h-[52px] items-center justify-between gap-2 rounded-xl p-2 text-left outline-none hover:bg-surface-container focus-visible:ring-[3px] focus-visible:ring-primary/50",
                  candidate.name === siteName &&
                    "bg-primary-bg hover:bg-primary-bg",
                )}
              >
                <span className="min-w-0 truncate font-semibold">
                  {candidate.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-xl px-2.5 py-0.5 text-xs font-bold",
                    isDefault
                      ? "bg-surface-container text-on-surface-variant"
                      : "bg-white text-primary-fg ring-1 ring-primary/40",
                  )}
                >
                  {isDefault ? "SXA default" : "Custom"}
                </span>
              </button>
            );
          })}
        </nav>

        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-xl border border-border-muted bg-white p-6">
          <div>
            <h2 className="font-semibold">{site.name}</h2>
            <p className={cn(HELP, "mt-1")}>
              {tab === "general"
                ? "How redirects are stored in this site"
                : "How tests reach this site when it is protected on Vercel"}
            </p>
          </div>

          {/* Blok "line" tabs (STYLE-GUIDE.md › Tabs). */}
          <div
            role="tablist"
            aria-label="Site setup"
            className="-mt-1 flex border-b-2 border-border-muted"
          >
            {TABS.map(([value, label]) => (
              <button
                key={value}
                id={`setup-tab-${value}`}
                type="button"
                role="tab"
                aria-selected={tab === value}
                aria-controls={`setup-panel-${value}`}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-0.5 inline-flex h-9 items-center gap-1.5 border-b-2 px-4 font-medium outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-primary/50",
                  tab === value
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface",
                )}
              >
                {label}
                {value === "vercel" && draft.vercelBypass && (
                  <Icon
                    path={mdiShieldCheckOutline}
                    size={0.6}
                    className="text-success-fg"
                    title="Bypass secret saved"
                  />
                )}
              </button>
            ))}
          </div>

          {tab === "general" ? (
            <div
              id="setup-panel-general"
              role="tabpanel"
              aria-labelledby="setup-tab-general"
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="setup-template" className={LABEL}>
                  1 · Redirect template
                </label>
                <div className="flex gap-2">
                  <input
                    id="setup-template"
                    type="text"
                    value={templateInput}
                    placeholder={DEFAULT_SITE_SETUP.templatePath}
                    onChange={(event) => {
                      setTemplateInputs((current) => ({
                        ...current,
                        [siteName]: event.target.value,
                      }));
                      setTemplateCheck({ status: "idle" });
                    }}
                    className={TEXT_INPUT}
                  />
                  <Button
                    variant="outline"
                    disabled={templateCheck.status === "checking"}
                    onClick={() => void checkTemplate()}
                  >
                    Check
                  </Button>
                </div>
                <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs">
                  {usesSxaDefault(draft) && <Tag>SXA DEFAULT</Tag>}
                  {templateCheck.status === "checking" && (
                    <>
                      <Icon
                        path={mdiLoading}
                        size={0.55}
                        className="animate-spin text-text-subtle"
                      />
                      <span className="text-text-subtle">Looking for the template</span>
                    </>
                  )}
                  {templateCheck.status === "found" && (
                    <>
                      <Icon path={mdiCheck} size={0.6} className="text-success-fg" />
                      <span className="font-semibold text-success-fg">
                        {templateCheck.name}
                      </span>
                    </>
                  )}
                  {templateCheck.status === "missing" && (
                    <span className="text-danger-fg">
                      No template found. Enter its full path or item ID.
                    </span>
                  )}
                  <span className="font-mono text-text-subtle">{draft.templateId}</span>
                </div>
                <p className={HELP}>
                  Items created from this template are treated as redirects. Enter
                  the template&apos;s path or item ID.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="setup-field" className={LABEL}>
                  2 · Destination field
                </label>
                <input
                  id="setup-field"
                  type="text"
                  value={draft.fieldName}
                  placeholder={DEFAULT_SITE_SETUP.fieldName}
                  onChange={(event) => update({ fieldName: event.target.value })}
                  className={TEXT_INPUT}
                />
                <p className={HELP}>
                  Name of the General Link field on that template that holds where
                  to redirect.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="setup-root" className={LABEL}>
                  3 · Where redirects live
                </label>
                <input
                  id="setup-root"
                  type="text"
                  value={draft.rootPath}
                  placeholder={redirectsRootPath(site, {
                    ...draft,
                    rootPath: "",
                  })}
                  onChange={(event) => update({ rootPath: event.target.value })}
                  className={TEXT_INPUT}
                />
                <p className={HELP}>
                  A redirect&apos;s From path is its item path below this item.
                  Leave empty to use the site&apos;s start item.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className={LABEL}>4 · Live URLs</div>
                {siteLanguages(site, DEFAULT_LANGUAGE).map((language) => (
                  <label
                    key={language}
                    className="flex h-10 items-center gap-2.5 rounded-xl border border-border-muted bg-white px-3 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/50"
                  >
                    <Tag className="w-14 text-center">{language}</Tag>
                    <input
                      type="text"
                      aria-label={`Live URL for ${language}`}
                      value={draft.urls[language] ?? ""}
                      placeholder={
                        detectedBase(site, language)
                          ? displayBase(detectedBase(site, language))
                          : "www.example.com"
                      }
                      onChange={(event) =>
                        update({
                          urls: { ...draft.urls, [language]: event.target.value },
                        })
                      }
                      className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-on-surface outline-none placeholder:text-text-subtle"
                    />
                  </label>
                ))}
                <p className={HELP}>
                  One per site language. Shown in the site picker and used as the
                  address when testing. Leave empty to use the address from the
                  site&apos;s settings (shown in grey).
                </p>
              </div>

              <label className="flex items-center gap-2.5">
                <Checkbox
                  checked={draft.publishOnSave}
                  onChange={(event) =>
                    update({ publishOnSave: event.target.checked })
                  }
                />
                <span>
                  Tick &ldquo;Publish immediately&rdquo; by default
                </span>
              </label>

              <label className="flex items-start gap-2.5">
                <Checkbox
                  className="mt-0.5"
                  checked={draft.allowChains}
                  onChange={(event) =>
                    update({ allowChains: event.target.checked })
                  }
                />
                <span>
                  Allow redirect chains
                  <span className={cn(HELP, "block")}>
                    A redirect that goes through more than one hop before the
                    final page is reported as Working instead of a warning.
                  </span>
                </span>
              </label>
            </div>
          ) : (
            <VercelPanel
              bypass={draft.vercelBypass}
              hosts={siteHosts(site, draft, DEFAULT_LANGUAGE)}
              input={secretInputs[siteName]}
              error={secretError}
              disabled={busy}
              onInput={(value) => {
                setSecretError("");
                setSecretInputs((current) => {
                  if (value !== undefined) return { ...current, [siteName]: value };
                  const rest = { ...current };
                  delete rest[siteName];
                  return rest;
                });
              }}
              onRemove={() => {
                setSecretError("");
                update({ vercelBypass: null });
              }}
            />
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {tab === "general" && (
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Reset to SXA default
              </Button>
            )}
            <Button onClick={() => void save()} disabled={busy}>
              {busy && (
                <Icon path={mdiLoading} size={0.7} className="animate-spin" />
              )}
              Save setup
            </Button>
          </div>
        </section>
      </div>

      <p className="text-left text-[10px] text-[#94A3B8]">
        Developed by Roberto Barbedo · Redirects · v
        {process.env.NEXT_PUBLIC_APP_VERSION}
      </p>
    </>
  );
}

/**
 * The Vercel tab: the site's Protection Bypass for Automation secret. A saved
 * secret is never shown again — only replaced or removed.
 */
function VercelPanel({
  bypass,
  hosts,
  input,
  error,
  disabled,
  onInput,
  onRemove,
}: {
  bypass: VercelBypass | null;
  /** Current hosts of the site's live URLs. */
  hosts: string[];
  /** Typed secret; undefined while the saved one is shown. */
  input: string | undefined;
  error: string;
  disabled: boolean;
  /** A string opens/updates the input; undefined closes it. */
  onInput: (value: string | undefined) => void;
  onRemove: () => void;
}) {
  const editing = !bypass || input !== undefined;
  const hostsChanged = bypass !== null && !sameHosts(bypass.hosts, hosts);

  return (
    <div
      id="setup-panel-vercel"
      role="tabpanel"
      aria-labelledby="setup-tab-vercel"
      className="flex flex-col gap-5"
    >
      <div className="rounded-xl border border-border-muted bg-surface-container-low p-4 text-sm">
        <p>
          Only needed when this site is hosted on Vercel with{" "}
          <strong>Deployment Protection</strong> (Password Protection or Vercel
          Authentication). Without it, tests get the login page (401) instead
          of the redirect.
        </p>
        <p className="mt-2 text-text-subtle">
          In Vercel, open the project → Settings → Deployment Protection →{" "}
          <strong className="text-on-surface">
            Protection Bypass for Automation
          </strong>
          , create a secret and paste it below.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="setup-vercel-secret" className={LABEL}>
          Protection bypass secret
        </label>

        {editing ? (
          <div className="flex gap-2">
            <input
              id="setup-vercel-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={input ?? ""}
              disabled={disabled}
              placeholder="Paste the secret from Vercel"
              onChange={(event) => onInput(event.target.value)}
              className={TEXT_INPUT}
            />
            {bypass && (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => onInput(undefined)}
              >
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-muted bg-white px-3 py-2.5">
            <Icon
              path={mdiShieldCheckOutline}
              size={0.75}
              className="text-success-fg"
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Secret saved</div>
              <div className="truncate text-xs text-text-subtle">
                Sent only to {bypass.hosts.join(", ")}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onInput("")}
            >
              Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onRemove}
            >
              Remove
            </Button>
          </div>
        )}

        <p className={HELP}>
          Tests send it in the <code>x-vercel-protection-bypass</code> header,
          only to this site&apos;s own hosts
          {hosts.length > 0 ? ` (${hosts.join(", ")})` : ""}, never to the
          pages a redirect points to elsewhere. It is encrypted before it is
          saved and never shown again. Saved with{" "}
          <strong className="font-semibold">Save setup</strong>.
        </p>
      </div>

      {hostsChanged && !editing && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#ba5200]/40 bg-[#ffe6bd] p-3 text-sm text-[#953d00]">
          <Icon
            path={mdiAlertCircleOutline}
            size={0.75}
            className="mt-px shrink-0"
          />
          <span>
            The site&apos;s live URLs changed since the secret was saved, so it
            is only sent to {bypass.hosts.join(", ")}. Replace it to use it for{" "}
            {hosts.join(", ") || "the new URLs"}.
          </span>
        </div>
      )}

      <p className={HELP}>
        <strong className="font-semibold text-on-surface">
          Using Password Protection?
        </strong>{" "}
        Vercel only accepts the password in a browser, so tests can&apos;t use
        it. A bypass secret gets past the password too.
      </p>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger bg-danger-bg p-3 text-sm text-danger-fg">
          <Icon
            path={mdiAlertCircleOutline}
            size={0.75}
            className="mt-px shrink-0"
          />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
