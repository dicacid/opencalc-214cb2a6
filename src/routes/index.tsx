import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SubwooferNoiseCalculator } from "@/components/SubwooferNoiseCalculator";
import "@/styles/arraycalc.css";
import "@/styles/subwoofer-noise.css";

const title = "Array Planner — line array, subwoofer SPL & noise planning";
const description =
  "Browser-based line array simulator with coherent complex summation, ISO 9613-1 air absorption, rigging checks, and a low-frequency subwoofer noise planning calculator.";

type CalculatorTab = "array" | "subwoofer-noise";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<CalculatorTab>("array");

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let disposed = false;
    void import("@/lib/arraycalc/app").then(({ bootArrayCalc }) => {
      if (!disposed && ref.current) bootArrayCalc(ref.current);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (window.location.hash === "#subwoofer-noise") setTab("subwoofer-noise");
  }, []);

  const selectTab = (next: CalculatorTab) => {
    setTab(next);
    const nextUrl = next === "subwoofer-noise"
      ? `${window.location.pathname}${window.location.search}#subwoofer-noise`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
  };

  return (
    <div className="calc-app-shell">
      <nav className="calc-mode-tabs" role="tablist" aria-label="Calculator mode">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "array"}
          className={`calc-mode-tab ${tab === "array" ? "on" : ""}`}
          onClick={() => selectTab("array")}
        >
          Array Planner
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "subwoofer-noise"}
          className={`calc-mode-tab ${tab === "subwoofer-noise" ? "on" : ""}`}
          onClick={() => selectTab("subwoofer-noise")}
        >
          Subwoofer Noise
        </button>
        <span className="calc-brand">CadenceOps · OpenCalc</span>
      </nav>

      <h1 className="sr-only">Array Planner — loudspeaker array SPL and subwoofer noise prediction</h1>
      <div
        ref={ref}
        className="ac-root"
        style={{ display: tab === "array" ? undefined : "none" }}
        aria-hidden={tab !== "array"}
      />
      {tab === "subwoofer-noise" ? <SubwooferNoiseCalculator /> : null}
    </div>
  );
}
