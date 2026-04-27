import { useCallback, useEffect, useState } from "react";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import type { TutorialStep } from "./tutorialSteps";

interface TutorialOverlayProps {
  onComplete: () => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TOOLTIP_WIDTH = 300;
const SPOTLIGHT_PAD = 5;
const TOOLTIP_GAP = 12;

// ---------------------------------------------------------------------------
// Tooltip card
// ---------------------------------------------------------------------------

function TutorialCard({
  step,
  stepIdx,
  total,
  isLast,
  onNext,
  onSkip,
}: {
  step: TutorialStep;
  stepIdx: number;
  total: number;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl"
      style={{ width: TOOLTIP_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bar */}
      <div className="flex gap-1 px-4 pt-4">
        {TUTORIAL_STEPS.map((_, i) => (
          <div
            key={i}
            className="h-1 rounded-full transition-all duration-200"
            style={{
              flex: i === stepIdx ? 2 : 1,
              background: i <= stepIdx
                ? "var(--color-accent)"
                : "var(--color-border)",
            }}
          />
        ))}
      </div>

      <div className="px-4 pb-4 pt-3">
        {/* Step counter */}
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
          {stepIdx + 1} of {total}
        </div>

        {/* Title */}
        <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          {step.title}
        </h3>

        {/* Body */}
        <p className="mb-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {step.body}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          {!isLast ? (
            <button
              onClick={onSkip}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Skip tour
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onNext}
            className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            {isLast ? "Get Started" : (
              <>
                Next
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5h6M5 2l3 3-3 3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip placement
// ---------------------------------------------------------------------------

function getTooltipStyle(
  rect: SpotlightRect,
  placement: TutorialStep["placement"] = "bottom"
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PAD = 10;

  function clampLeft(left: number) {
    return Math.max(PAD, Math.min(vw - TOOLTIP_WIDTH - PAD, left));
  }

  const centeredLeft = clampLeft(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2);
  const spotBottom = rect.top + rect.height + SPOTLIGHT_PAD;
  const spotTop = rect.top - SPOTLIGHT_PAD;

  switch (placement) {
    case "bottom":
      return { top: spotBottom + TOOLTIP_GAP, left: centeredLeft };
    case "top":
      // anchor to bottom so the card grows upward from the gap
      return { bottom: vh - spotTop + TOOLTIP_GAP, left: centeredLeft };
    case "right":
      return {
        top: Math.max(PAD, rect.top),
        left: rect.left + rect.width + SPOTLIGHT_PAD + TOOLTIP_GAP,
      };
    case "left":
      return {
        top: Math.max(PAD, rect.top),
        left: Math.max(PAD, rect.left - SPOTLIGHT_PAD - TOOLTIP_GAP - TOOLTIP_WIDTH),
      };
  }
}

// ---------------------------------------------------------------------------
// Main overlay
// ---------------------------------------------------------------------------

export default function TutorialOverlay({ onComplete }: TutorialOverlayProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);

  const step = TUTORIAL_STEPS[stepIdx];
  const isLast = stepIdx === TUTORIAL_STEPS.length - 1;

  const measureTarget = useCallback(() => {
    if (!step.target) {
      setSpotlightRect(null);
      return;
    }
    const el = document.querySelector(`[data-tutorial="${step.target}"]`);
    if (!el) {
      setSpotlightRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSpotlightRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  useEffect(() => {
    measureTarget();
    window.addEventListener("resize", measureTarget);
    return () => window.removeEventListener("resize", measureTarget);
  }, [measureTarget]);

  function handleNext() {
    if (isLast) {
      onComplete();
    } else {
      setStepIdx((i) => i + 1);
    }
  }

  // Centered modal (no target, or target element not yet in DOM)
  if (!step.target || !spotlightRect) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55"
        style={{ animation: "tutorialFadeIn 150ms ease" }}
      >
        <TutorialCard
          step={step}
          stepIdx={stepIdx}
          total={TUTORIAL_STEPS.length}
          isLast={isLast}
          onNext={handleNext}
          onSkip={onComplete}
        />
      </div>
    );
  }

  // Spotlight step — full-screen backdrop via box-shadow cutout
  const tooltipStyle = getTooltipStyle(spotlightRect, step.placement);

  return (
    <div
      className="fixed inset-0 z-[9999]"
      style={{ animation: "tutorialFadeIn 150ms ease" }}
    >
      {/* Spotlight: transparent element whose box-shadow fills the rest of the screen */}
      <div
        style={{
          position: "fixed",
          top: spotlightRect.top - SPOTLIGHT_PAD,
          left: spotlightRect.left - SPOTLIGHT_PAD,
          width: spotlightRect.width + SPOTLIGHT_PAD * 2,
          height: spotlightRect.height + SPOTLIGHT_PAD * 2,
          borderRadius: 6,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          outline: "1.5px solid rgba(255,255,255,0.15)",
          pointerEvents: "none",
        }}
      />

      {/* Tooltip */}
      <div
        style={{
          position: "fixed",
          width: TOOLTIP_WIDTH,
          zIndex: 10000,
          ...tooltipStyle,
        }}
      >
        <TutorialCard
          step={step}
          stepIdx={stepIdx}
          total={TUTORIAL_STEPS.length}
          isLast={isLast}
          onNext={handleNext}
          onSkip={onComplete}
        />
      </div>
    </div>
  );
}
