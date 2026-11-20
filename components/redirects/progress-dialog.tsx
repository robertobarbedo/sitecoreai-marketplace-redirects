"use client";

import {
  mdiAlert,
  mdiCheck,
  mdiClose,
  mdiCloudUploadOutline,
  mdiContentSaveOutline,
  mdiRadar,
  mdiTranslate,
} from "@mdi/js";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import type { ProgressStep, TestResult } from "@/src/types/redirects";

export interface ProgressState {
  title: string;
  subtitle: string;
  steps: ProgressStep[];
  /** True once nothing else will happen. */
  finished: boolean;
  /** Outcome of the last live test, when the flow tests. */
  result: TestResult | null;
}

type Tone = "busy" | "success" | "warning" | "danger";

/** What the stage in the middle of the dialog shows right now. */
interface Scene {
  key: string;
  tone: Tone;
  icon: string;
  headline: string;
  detail: string;
}

/** Icon, friendly sentence and short tracker name per step of the save flow. */
const STEP_VIEW: Record<string, { icon: string; doing: string; short: string }> = {
  save: {
    icon: mdiContentSaveOutline,
    doing: "Saving your redirect",
    short: "Save",
  },
  languages: {
    icon: mdiTranslate,
    doing: "Copying it to the other languages",
    short: "Languages",
  },
  publish: {
    icon: mdiCloudUploadOutline,
    doing: "Publishing to the live site",
    short: "Publish",
  },
  test: {
    icon: mdiRadar,
    doing: "Checking that the live URL redirects",
    short: "Test",
  },
};

const TONE_ICON: Record<Exclude<Tone, "busy">, string> = {
  success: mdiCheck,
  warning: mdiAlert,
  danger: mdiClose,
};

const TONE_DISC: Record<Tone, string> = {
  busy: "bg-primary text-white",
  success: "bg-success text-white",
  warning: "bg-[#ba5200] text-white",
  danger: "bg-danger text-white",
};

const TONE_RING: Record<Tone, string> = {
  busy: "bg-primary",
  success: "bg-success",
  warning: "bg-[#ba5200]",
  danger: "bg-danger",
};

function failed(steps: ProgressStep[], id: string): ProgressStep | undefined {
  return steps.find((step) => step.id === id && step.status === "failed");
}

function finishedScene(state: ProgressState): Scene {
  const end = (tone: Exclude<Tone, "busy">, headline: string, detail: string) => ({
    key: `end-${tone}`,
    tone,
    icon: TONE_ICON[tone],
    headline,
    detail,
  });

  const save = failed(state.steps, "save");
  if (save) return end("danger", "The redirect could not be saved", save.detail);

  const languages = failed(state.steps, "languages");
  const publish = failed(state.steps, "publish");
  if (publish) {
    return end("warning", "Saved, but it could not be published", publish.detail);
  }

  const result = state.result;
  if (result) {
    if (result.level === "working") {
      return end(
        languages ? "warning" : "success",
        languages
          ? "Live and working, but not saved in every language"
          : "All done. Your redirect is live and working",
        languages ? languages.detail : result.detail,
      );
    }
    if (result.level === "warning") {
      return end("warning", `Published, with a warning: ${result.note}`, result.detail);
    }
    if (result.level === "broken") {
      return end(
        "danger",
        "Published, but the redirect is not working yet",
        result.detail || result.note,
      );
    }
    return end(
      "warning",
      "Published. The live test could not run",
      result.detail || result.note,
    );
  }

  if (languages) {
    return end("warning", "Saved, but not in every language", languages.detail);
  }
  return end("success", "All done. Your redirect is saved", "");
}

function currentScene(state: ProgressState): Scene {
  if (state.finished) return finishedScene(state);
  const step =
    state.steps.find((candidate) => candidate.status === "running") ??
    state.steps.find((candidate) => candidate.status === "pending") ??
    state.steps[state.steps.length - 1];
  const view = STEP_VIEW[step?.id ?? "save"] ?? STEP_VIEW.save;
  return {
    key: step?.id ?? "save",
    tone: "busy",
    icon: view.icon,
    headline: view.doing,
    detail: step?.detail ?? "",
  };
}

/**
 * Live view of a save. A fixed-height dialog with an animated stage in the
 * middle that says, in plain words, what is happening right now (saving,
 * publishing, the repeated live tests), and a small tracker underneath.
 *
 * It can be closed at any time — what was already saved stays saved; only the
 * remaining test attempts are skipped.
 */
export function ProgressDialog({
  state,
  onClose,
}: {
  state: ProgressState | null;
  onClose: () => void;
}) {
  const scene = state ? currentScene(state) : null;
  const busy = scene?.tone === "busy";

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[620px] max-h-[calc(100vh-2rem)] max-w-[580px] grid-rows-[auto_minmax(0,1fr)_auto] gap-5">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {state?.title ?? ""}
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-xs text-text-subtle">
            {state?.subtitle ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto text-center">
          {scene && (
            <>
              <div className="relative flex size-36 shrink-0 items-center justify-center">
                {busy && (
                  <>
                    <span
                      className={cn(
                        "progress-ring absolute size-24 rounded-full",
                        TONE_RING[scene.tone],
                      )}
                    />
                    <span
                      className={cn(
                        "progress-ring progress-ring-late absolute size-24 rounded-full",
                        TONE_RING[scene.tone],
                      )}
                    />
                  </>
                )}
                <span
                  className={cn(
                    "absolute size-32 rounded-full opacity-10",
                    TONE_RING[scene.tone],
                  )}
                />
                <span
                  key={scene.key}
                  className={cn(
                    "progress-pop relative flex size-24 items-center justify-center rounded-full",
                    TONE_DISC[scene.tone],
                  )}
                >
                  <Icon
                    path={scene.icon}
                    size={1.9}
                    className={cn(busy && "progress-float")}
                  />
                </span>
              </div>

              <div
                className="flex max-w-[440px] flex-col gap-1.5"
                aria-live="polite"
              >
                <div key={scene.key} className="progress-rise text-lg font-bold">
                  {scene.headline}
                  {busy && (
                    <span className="progress-dots" aria-hidden="true">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  )}
                </div>
                <div className="min-h-10 break-words text-sm text-text-subtle">
                  {scene.detail}
                </div>
              </div>

              <ol className="flex items-start justify-center">
                {(state?.steps ?? []).map((step, index) => (
                  <li key={step.id} className="flex items-start">
                    {index > 0 && (
                      <span
                        className={cn(
                          "mt-[11px] h-0.5 w-10 rounded-full transition-colors duration-500",
                          step.status === "pending"
                            ? "bg-border-muted"
                            : "bg-primary",
                        )}
                      />
                    )}
                    <span className="flex w-[72px] flex-col items-center gap-1.5">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-500",
                          step.status === "pending" &&
                            "border-border-muted bg-white",
                          step.status === "running" &&
                            "progress-beat border-primary bg-white",
                          step.status === "done" &&
                            "border-primary bg-primary text-white",
                          step.status === "failed" &&
                            "border-danger bg-danger text-white",
                        )}
                      >
                        {step.status === "done" && (
                          <Icon path={mdiCheck} size={0.55} />
                        )}
                        {step.status === "failed" && (
                          <Icon path={mdiClose} size={0.55} />
                        )}
                        {step.status === "running" && (
                          <span className="size-2 rounded-full bg-primary" />
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-xs",
                          step.status === "pending"
                            ? "text-text-subtle"
                            : "font-semibold",
                        )}
                      >
                        {STEP_VIEW[step.id]?.short ?? step.label}
                        <span className="sr-only">: {step.status}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-text-subtle">
            {state?.finished
              ? ""
              : "You can close this at any time. Saved changes are kept."}
          </span>
          <Button variant={state?.finished ? "default" : "outline"} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
