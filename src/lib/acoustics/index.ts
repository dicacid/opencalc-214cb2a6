import * as ENV from "./env";
import * as CAB from "./cabinets";
import * as GEO from "./geometry";
import * as SOL from "./solver";

export * from "./env";
export * from "./cabinets";
export * from "./geometry";
export * from "./solver";

/** Flat bundle consumed by the application shell. */
export const P = { ...ENV, ...CAB, ...GEO, ...SOL } as Record<string, any>;
