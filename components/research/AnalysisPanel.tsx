/**
 * "Cited AI analysis" on the paper screen.
 *
 *  - NOTHING runs when the screen opens. The analysis (a paid model call) starts only when the user presses the button.
 *  - Each statement in the result is shown with a control that fetches the sentence of the paper it came from; where the paper's licence
 *    does not allow showing text, the card says so and links to the original paper.
 *  - The result is described as "checked by automatic rules", never as verified or accurate, and the server's confidence number is not
 *    read or shown.
 *
 * AnalysisPanelView is the drawing; AnalysisPanel adds sign-in state, the API and the single run function.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/services/auth/firebaseSession";
import { describeApiError } from "@/services/auth/apiClient";
import { AnalysisProgress, backendPaperRef, forgetPersonalProject, runAnalysis } from "@/services/analysisClient";
import { AnalysisView, EvidenceSpan, SentenceResult, StatementView, clearEvidenceCache, parseAnalysisForDisplay, resultAsStatement } from "@/services/evidenceModel";
import { EvidenceStatementCard } from "./EvidenceStatementCard";
import { EvidenceSummaryNote } from "./EvidenceSummaryNote";

export const ANALYSIS_COPY = {
  heading: "Cited AI analysis",
  intro: "Asks an AI model for this paper's problem, method, findings and limitations, each linked to the sentence of the paper it came from. It uses part of your daily AI allowance and takes about a minute. Nothing runs until you press the button.",
  run: "Run AI analysis",
  runAgain: "Run again (uses allowance)",
  stop: "Stop waiting",
  signedOut: "Sign in to run an AI analysis of this paper.",
  noRef: "This record has no DOI, PubMed id or arXiv id, so it can't be analysed here.",
  preparing: "Getting ready...",
  queued: "Waiting for a free analysis slot...",
  running: "Analysing the paper...",
  retry: "Try again (uses allowance)",
  noStatements: "The analysis returned nothing that passed the automatic checks. Open the original paper to read it.",
  resultsHeading: "Results",
  statementsHeading: "Statements"
} as const;

export type PanelState =
  | { kind: "SIGNED_OUT" }
  | { kind: "NO_REF" }
  | { kind: "IDLE" }
  | { kind: "RUNNING"; step: AnalysisProgress }
  | { kind: "DONE"; view: AnalysisView }
  | { kind: "MESSAGE"; message: string; canRetry: boolean };

type ViewProps = {
  state: PanelState;
  paperUrl: string | null;
  onRun: () => void;
  onStop: () => void;
  /** Test/preview seam: extra props for each card (e.g. a fake loader). The app passes nothing. */
  cardProps?: (s: StatementView) => { loader?: (span: EvidenceSpan) => Promise<SentenceResult>; preview?: { results: { span: EvidenceSpan; result: SentenceResult }[] } };
};

export function AnalysisPanelView({ state, paperUrl, onRun, onStop, cardProps }: ViewProps) {
  return (
    <View style={styles.wrap} accessibilityLabel="Cited AI analysis">
      <Text style={styles.heading}>{ANALYSIS_COPY.heading}</Text>

      {state.kind === "SIGNED_OUT" ? <Text style={styles.note}>{ANALYSIS_COPY.signedOut}</Text> : null}
      {state.kind === "NO_REF" ? <Text style={styles.note}>{ANALYSIS_COPY.noRef}</Text> : null}

      {state.kind === "IDLE" ? (
        <>
          <Text style={styles.note}>{ANALYSIS_COPY.intro}</Text>
          <Pressable accessibilityRole="button" onPress={onRun} style={styles.primary}>
            <Text style={styles.primaryText}>{ANALYSIS_COPY.run}</Text>
          </Pressable>
        </>
      ) : null}

      {state.kind === "RUNNING" ? (
        <>
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.note}>{state.step === "PREPARING" ? ANALYSIS_COPY.preparing : state.step === "QUEUED" ? ANALYSIS_COPY.queued : ANALYSIS_COPY.running}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onStop} style={styles.secondary}>
            <Text style={styles.secondaryText}>{ANALYSIS_COPY.stop}</Text>
          </Pressable>
        </>
      ) : null}

      {state.kind === "MESSAGE" ? (
        <>
          <Text style={styles.note}>{state.message}</Text>
          {state.canRetry ? (
            <Pressable accessibilityRole="button" onPress={onRun} style={styles.secondary}>
              <Text style={styles.secondaryText}>{ANALYSIS_COPY.retry}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {state.kind === "DONE" ? <Done view={state.view} paperUrl={paperUrl} onRun={onRun} cardProps={cardProps} /> : null}
    </View>
  );
}

function Done({ view, paperUrl, onRun, cardProps }: { view: AnalysisView; paperUrl: string | null; onRun: () => void; cardProps?: ViewProps["cardProps"] }) {
  const link = paperUrl || view.sourceUrl;
  const results = view.results.map(resultAsStatement);
  return (
    <View>
      <EvidenceSummaryNote view={view} />
      {view.statements.length === 0 && results.length === 0 ? <Text style={styles.note}>{ANALYSIS_COPY.noStatements}</Text> : null}
      {view.statements.map((s) => (
        <EvidenceStatementCard key={s.key} paperId={view.paperId} statement={s} paperUrl={link} {...(cardProps ? cardProps(s) : {})} />
      ))}
      {results.length > 0 ? <Text style={styles.subheading}>{ANALYSIS_COPY.resultsHeading}</Text> : null}
      {results.map((s) => (
        <EvidenceStatementCard key={s.key} paperId={view.paperId} statement={s} paperUrl={link} {...(cardProps ? cardProps(s) : {})} />
      ))}
      <Pressable accessibilityRole="button" onPress={onRun} style={styles.secondary}>
        <Text style={styles.secondaryText}>{ANALYSIS_COPY.runAgain}</Text>
      </Pressable>
    </View>
  );
}

type PanelProps = { paper: { id?: string; doi?: string; originalLink?: string } | null };

export function AnalysisPanel({ paper }: PanelProps) {
  const { status, user } = useAuth();
  const uid = user ? user.uid : null;
  const ref = useMemo(() => backendPaperRef(paper), [paper?.id, paper?.doi]);
  const [state, setState] = useState<PanelState>({ kind: "IDLE" });
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);

  // A different paper or user: forget the previous result, stop waiting, and drop cached sentences of the previous session.
  useEffect(() => {
    abort.current?.abort();
    running.current = false;
    setState({ kind: "IDLE" });
    return () => {
      abort.current?.abort();
    };
  }, [ref, uid]);
  useEffect(() => {
    if (!uid) {
      clearEvidenceCache();
      forgetPersonalProject();
    }
  }, [uid]);

  // THE ONLY place an analysis is started. It is bound to a button's onPress below and called from nowhere else.
  const run = useCallback(async () => {
    if (!ref || !uid || running.current) return;
    running.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "RUNNING", step: "PREPARING" });
    const outcome = await runAnalysis(uid, ref, "STANDARD", { api, describeError: describeApiError, signal: controller.signal, onProgress: (step) => setState({ kind: "RUNNING", step }) });
    running.current = false;
    if (controller.signal.aborted) {
      return; // the user stopped waiting, or the paper/user changed: this result is for nobody (stop() already set the message)
    }
    if (outcome.kind === "DONE") {
      const view = parseAnalysisForDisplay(outcome.body);
      setState(view ? { kind: "DONE", view } : { kind: "MESSAGE", message: "The analysis finished but returned nothing to show.", canRetry: true });
    } else if (outcome.kind === "UNAVAILABLE") {
      setState({ kind: "MESSAGE", message: outcome.message || "No paper text is available to analyse.", canRetry: false });
    } else if (outcome.kind === "STOPPED" || outcome.kind === "TIMED_OUT") {
      setState({ kind: "MESSAGE", message: outcome.message, canRetry: true });
    } else {
      setState({ kind: "MESSAGE", message: outcome.message || "The analysis could not be completed.", canRetry: true });
    }
  }, [ref, uid]);

  const stop = useCallback(() => {
    abort.current?.abort();
    running.current = false;
    setState({ kind: "MESSAGE", message: "You stopped waiting. The analysis may still finish on the server.", canRetry: true });
  }, []);

  const shown: PanelState = !ref ? { kind: "NO_REF" } : status !== "SIGNED_IN" || !uid ? { kind: "SIGNED_OUT" } : state;
  const paperUrl = paper && typeof paper.originalLink === "string" && /^https?:\/\//i.test(paper.originalLink) ? paper.originalLink : null;
  return <AnalysisPanelView state={shown} paperUrl={paperUrl} onRun={run} onStop={stop} />;
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  heading: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 6 },
  subheading: { fontSize: 13, fontWeight: "700", color: colors.muted, marginTop: spacing.sm, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  note: { fontSize: 13, lineHeight: 19, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 6 },
  primary: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  primaryText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  secondary: { marginTop: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  secondaryText: { fontSize: 13, fontWeight: "600", color: colors.primary }
});
