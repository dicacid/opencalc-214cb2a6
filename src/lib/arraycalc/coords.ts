import type { Vec3 } from "@/lib/scenegraph/types";

/** Coordinate bridge.
 *
 *  Solver / scenegraph space: metres, Z-up, +Y toward the audience.
 *  Three.js render space:     metres, Y-up, -Z toward the audience.
 *
 *  Everything upstream of the renderer stays Z-up so acoustic results,
 *  exports and compliance checks share one convention. */

export type R3FVec = [number, number, number];

export const toR3F = (p: Vec3): R3FVec => [p[0], p[2], -p[1]];
export const fromR3F = (p: R3FVec): Vec3 => [p[0], -p[2], p[1]];

/** Direction vectors transform the same way (pure rotation). */
export const dirToR3F = toR3F;
export const dirFromR3F = fromR3F;

/** Euler angles: solver yaw is about Z (degrees, CCW from +Y),
 *  pitch is elevation above horizontal. */
export function orientationToR3F(yawDeg: number, pitchDeg: number): R3FVec {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  return [pitch, yaw, 0];
}

export const M_TO_FT = 3.280839895;
export const toFeet = (m: number) => m * M_TO_FT;
export const fromFeet = (ft: number) => ft / M_TO_FT;
