/**
 * StepProgress component — JANICE Returns Portal
 *
 * 5-stap voortgangsindicator bovenaan elke portalpagina.
 * Toont voltooide stappen in Camel, actieve stap in Onyx.
 * aria-current="step" op de actieve stap.
 */

import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";

interface StepProgressProps {
  currentStep: 1 | 2 | 3 | 4 | 5;
  locale?: Locale;
}

const STEP_KEYS = ["1", "2", "3", "4", "5"] as const;

export function StepProgress({ currentStep, locale = "nl" }: StepProgressProps) {
  return (
    <nav aria-label={locale === "nl" ? "Stapvoortgang" : "Step progress"}>
      <ol className="rp-step-progress">
        {STEP_KEYS.map((key, idx) => {
          const stepNum = idx + 1;
          const isCompleted = stepNum < currentStep;
          const isActive = stepNum === currentStep;

          return (
            <li key={key} className="rp-step-progress__step">
              <span
                className={clsx(
                  "rp-step-progress__dot",
                  isCompleted && "rp-step-progress__dot--completed",
                  isActive && "rp-step-progress__dot--active",
                )}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${locale === "nl" ? "Stap" : "Step"} ${stepNum}: ${t(locale, `steps.${key}`)}`}
              >
                {isCompleted ? (
                  <span aria-hidden="true">&#10003;</span>
                ) : (
                  <span aria-hidden="true">{stepNum}</span>
                )}
              </span>
              <span
                className={clsx(
                  "rp-step-progress__label",
                  isActive && "rp-step-progress__label--active",
                )}
                aria-hidden="true"
              >
                {t(locale, `steps.${key}`)}
              </span>
              {idx < STEP_KEYS.length - 1 && (
                <span
                  className={clsx(
                    "rp-step-progress__connector",
                    isCompleted && "rp-step-progress__connector--completed",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
