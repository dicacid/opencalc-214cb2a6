import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import "@/styles/arraycalc.css";

const title = "Array Planner — line array & subwoofer SPL prediction";
const description =
  "Browser-based line array simulator: coherent complex summation, ISO 9613-1 air absorption, auto splay, rigging load checks and parts lists for d&b-style systems.";

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

  return (
    <>
      <h1 className="sr-only">Array Planner — loudspeaker array SPL prediction</h1>
      <div ref={ref} className="ac-root" />
    </>
  );
}
