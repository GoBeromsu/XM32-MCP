/**
 * X32/M32 dB conversion utilities
 * Handles conversion between linear fader values (0.0-1.0) and dB values
 */

/**
 * Convert dB value to linear fader value (0.0-1.0)
 * X32 fader range: -∞ dB to +10 dB
 *
 * Key points:
 * - -∞ dB (off) = 0.0
 * - -90 dB ≈ 0.0 (practical minimum)
 * - 0 dB (unity) ≈ 0.75
 * - +10 dB (max) = 1.0
 *
 * @param db - Decibel value (-90 to +10)
 * @returns Linear fader value (0.0 to 1.0)
 */
export function dbToFader(db: number): number {
    // Handle special cases
    if (db <= -90) return 0.0; // -∞ dB or below practical minimum
    if (db >= 10) return 1.0; // Maximum +10 dB

    // X32 uses a specific logarithmic curve for fader values
    // Approximation based on X32 fader behavior:
    // -90 dB to -60 dB: 0.0 to 0.025 (very fine control at bottom)
    // -60 dB to -30 dB: 0.025 to 0.137
    // -30 dB to -10 dB: 0.137 to 0.397
    // -10 dB to 0 dB: 0.397 to 0.75 (unity gain)
    // 0 dB to +10 dB: 0.75 to 1.0

    if (db <= -60) {
        // -90 to -60 dB: linear mapping to 0.0-0.025
        return ((db + 90) / 30) * 0.025;
    } else if (db <= -30) {
        // -60 to -30 dB: linear mapping to 0.025-0.137
        return 0.025 + ((db + 60) / 30) * 0.112;
    } else if (db <= -10) {
        // -30 to -10 dB: linear mapping to 0.137-0.397
        return 0.137 + ((db + 30) / 20) * 0.26;
    } else if (db <= 0) {
        // -10 to 0 dB: linear mapping to 0.397-0.75
        return 0.397 + ((db + 10) / 10) * 0.353;
    } else {
        // 0 to +10 dB: linear mapping to 0.75-1.0
        return 0.75 + (db / 10) * 0.25;
    }
}

/**
 * Convert linear fader value (0.0-1.0) to dB value
 *
 * @param fader - Linear fader value (0.0 to 1.0)
 * @returns Decibel value (-∞ to +10)
 */
export function faderToDb(fader: number): number {
    // Clamp input
    if (fader <= 0) return -Infinity;
    if (fader >= 1) return 10;

    // Inverse mapping of dbToFader
    if (fader <= 0.025) {
        // 0.0-0.025: -90 to -60 dB
        return -90 + (fader / 0.025) * 30;
    } else if (fader <= 0.137) {
        // 0.025-0.137: -60 to -30 dB
        return -60 + ((fader - 0.025) / 0.112) * 30;
    } else if (fader <= 0.397) {
        // 0.137-0.397: -30 to -10 dB
        return -30 + ((fader - 0.137) / 0.26) * 20;
    } else if (fader <= 0.75) {
        // 0.397-0.75: -10 to 0 dB
        return -10 + ((fader - 0.397) / 0.353) * 10;
    } else {
        // 0.75-1.0: 0 to +10 dB
        return ((fader - 0.75) / 0.25) * 10;
    }
}

/**
 * Preamp gain: convert dB to linear (0.0-1.0)
 * Range: -12 dB to +60 dB (72 dB span, linear mapping)
 */
export function gainDbToLinear(db: number): number {
    return (db + 12) / 72;
}

/**
 * Preamp gain: convert linear (0.0-1.0) to dB
 * Range: -12 dB to +60 dB (72 dB span, linear mapping)
 */
export function linearToGainDb(linear: number): number {
    return -12 + (linear * 72);
}

/**
 * Common dB presets for quick access
 */
export const DB_PRESETS = {
    OFF: -Infinity, // Fader all the way down
    MINUS_90: -90, // Practical minimum
    MINUS_60: -60, // Very quiet
    MINUS_30: -30, // Quiet
    MINUS_20: -20, // Below nominal
    MINUS_10: -10, // 10 dB below unity
    MINUS_6: -6, // 6 dB below unity
    MINUS_3: -3, // 3 dB below unity
    UNITY: 0, // Unity gain (0 dB)
    PLUS_3: 3, // 3 dB above unity
    PLUS_6: 6, // 6 dB above unity
    PLUS_10: 10 // Maximum
};

/**
 * Format dB value for display
 *
 * @param db - Decibel value
 * @returns Formatted string (e.g., "0.0 dB", "-∞ dB", "+6.0 dB")
 */
export function formatDb(db: number): string {
    if (db === -Infinity || db <= -90) {
        return '-∞ dB';
    }
    const sign = db > 0 ? '+' : '';
    return `${sign}${db.toFixed(1)} dB`;
}

/**
 * Parse dB value from string input
 * Accepts formats: "0", "0dB", "0 dB", "+6dB", "-10 dB", "-inf", "-∞"
 *
 * @param input - String representation of dB value
 * @returns Parsed dB value or null if invalid
 */
export function parseDb(input: string): number | null {
    const normalized = input.trim().toLowerCase();

    // Check for infinity
    if (normalized === '-inf' || normalized === '-∞' || normalized === '-infinity') {
        return -Infinity;
    }

    // Remove 'db' suffix and spaces
    const cleaned = normalized.replace(/\s*db$/i, '').trim();

    // Parse the number
    const value = parseFloat(cleaned);
    if (isNaN(value)) {
        return null;
    }

    // Clamp to valid range
    if (value <= -90) return -Infinity;
    if (value > 10) return 10;

    return value;
}
