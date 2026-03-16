import { z } from 'zod';
import { dbToFader, faderToDb, gainDbToLinear, linearToGainDb } from '../utils/db-converter.js';
import { X32Error } from '../utils/error-helper.js';

export type VolumeUnit = 'linear' | 'db';

/**
 * Case-insensitive volume unit schema.
 * Accepts "dB", "DB", "db" etc. and normalizes to lowercase.
 */
export const volumeUnitSchema = (dbRange: string) =>
    z.preprocess(
        (val) => typeof val === 'string' ? val.toLowerCase() : val,
        z.enum(['linear', 'db'])
            .default('linear')
            .describe(`Unit: "linear" (0.0-1.0) or "db" (${dbRange}). Default: "linear"`)
    );

/**
 * Resolve a volume input (linear or dB) into both linear and dB values.
 * Uses the standard fader curve (dbToFader/faderToDb).
 *
 * @param value - The raw numeric input
 * @param unit - 'linear' or 'db'
 * @param dbRange - [min, max] dB range for validation (e.g., [-90, 10])
 * @returns Resolved values or an error string
 */
export function resolveVolume(
    value: number,
    unit: VolumeUnit,
    dbRange: [number, number]
): { linear: number; db: number } | { error: string } {
    if (unit === 'db') {
        if (value < dbRange[0] || value > dbRange[1]) {
            return { error: X32Error.invalidDb(value) };
        }
        return { linear: dbToFader(value), db: value };
    }
    if (value < 0 || value > 1) {
        return { error: X32Error.invalidLinear(value) };
    }
    return { linear: value, db: faderToDb(value) };
}

/**
 * Resolve a gain input (linear or dB) into both linear and dB values.
 * Uses the preamp gain curve (gainDbToLinear/linearToGainDb).
 */
export function resolveGain(
    value: number,
    unit: VolumeUnit,
    dbRange: [number, number]
): { linear: number; db: number } | { error: string } {
    if (unit === 'db') {
        if (value < dbRange[0] || value > dbRange[1]) {
            return { error: X32Error.invalidDb(value) };
        }
        return { linear: gainDbToLinear(value), db: value };
    }
    if (value < 0 || value > 1) {
        return { error: X32Error.invalidLinear(value) };
    }
    return { linear: value, db: linearToGainDb(value) };
}
