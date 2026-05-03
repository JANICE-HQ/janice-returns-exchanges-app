/**
 * Timeline component — JANICE Returns Portal
 *
 * Verticale tijdlijn van state-overgangen.
 * Onyx dots, Slate connectoren, Camel accent op actieve staat.
 */

import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import type { StateHistoryEntry, ReturnState } from "./types";

interface TimelineProps {
  history: StateHistoryEntry[];
  currentState: ReturnState;
  locale?: Locale;
}

export function Timeline({ history, currentState, locale = "nl" }: TimelineProps) {
  // Keer de volgorde om: nieuwste staat eerst
  const ordered = [...history].reverse();

  return (
    <section aria-label={t(locale, "status.timelineTitle")}>
      <h2
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-slate)",
          marginBottom: "var(--space-4)",
        }}
      >
        {t(locale, "status.timelineTitle")}
      </h2>
      <div className="rp-timeline">
        {ordered.map((entry, idx) => {
          const isCurrent = entry.toState === currentState && idx === 0;
          const isCompleted = !isCurrent;

          return (
            <div
              key={`${entry.toState}-${entry.createdAt}`}
              className="rp-timeline__step"
            >
              <div
                className={clsx(
                  "rp-timeline__dot",
                  isCurrent && "rp-timeline__dot--active",
                  isCompleted && "rp-timeline__dot--completed",
                )}
                aria-hidden="true"
              >
                {isCompleted ? "&#10003;" : ""}
              </div>
              <div className="rp-timeline__content">
                <p className="rp-timeline__state">
                  {t(locale, `status.states.${entry.toState}`)}
                  {isCurrent && (
                    <span
                      style={{
                        marginLeft: "8px",
                        fontSize: "10px",
                        background: "var(--color-camel)",
                        color: "var(--color-off-white)",
                        padding: "2px 6px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {locale === "nl" ? "Huidig" : "Current"}
                    </span>
                  )}
                </p>
                <p className="rp-timeline__meta">
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleDateString(
                      locale === "nl" ? "nl-NL" : "en-GB",
                      { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
                    )}
                  </time>
                  {entry.actorType === "ops_user" && (
                    <span style={{ marginLeft: "6px", color: "var(--color-camel)" }}>
                      {locale === "nl" ? "— Klantenservice" : "— Customer service"}
                    </span>
                  )}
                </p>
                {entry.note && (
                  <p className="rp-timeline__note">{entry.note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
