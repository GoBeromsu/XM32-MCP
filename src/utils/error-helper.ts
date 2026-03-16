/**
 * Simple error helper for X32-MCP
 * Centralized error messages for MVP
 *
 * @example
 * ```typescript
 * import { X32Error } from '../utils/error-helper.js';
 *
 * // In your tool implementation
 * if (!connection.connected) {
 *     return {
 *         content: [{ type: 'text', text: X32Error.notConnected() }],
 *         isError: true
 *     };
 * }
 * ```
 */

export class X32Error {
    /**
     * Returns error message when X32/M32 connection is required but not established
     *
     * @returns Formatted error message with connection instructions
     *
     * @example
     * ```typescript
     * if (!connection.connected) {
     *     return {
     *         content: [{ type: 'text', text: X32Error.notConnected() }],
     *         isError: true
     *     };
     * }
     * ```
     */
    static notConnected(): string {
        return `Not connected to X32/M32 mixer.

Use connection_connect first:
  connection_connect with host="192.168.1.100" and port=10023`;
    }

    /**
     * Returns error message for invalid channel number
     *
     * @param channel - The invalid channel number that was provided
     * @returns Formatted error message with valid range
     *
     * @example
     * ```typescript
     * const channelSchema = z.number().min(1).max(32);
     * const parsed = channelSchema.safeParse(channel);
     * if (!parsed.success) {
     *     return {
     *         content: [{ type: 'text', text: X32Error.invalidChannel(channel) }],
     *         isError: true
     *     };
     * }
     * ```
     */
    static invalidChannel(channel: number): string {
        return `Invalid channel: ${channel}. Must be 1-32.`;
    }

    /**
     * Returns error message for invalid bus number
     *
     * @param bus - The invalid bus number that was provided
     * @returns Formatted error message with valid range
     *
     * @example
     * ```typescript
     * if (bus < 1 || bus > 16) {
     *     return {
     *         content: [{ type: 'text', text: X32Error.invalidBus(bus) }],
     *         isError: true
     *     };
     * }
     * ```
     */
    static invalidBus(bus: number): string {
        return `Invalid bus: ${bus}. Must be 1-16.`;
    }

    /**
     * Returns error message for invalid FX rack number
     *
     * @param fx - The invalid FX rack number that was provided
     * @returns Formatted error message with valid range
     *
     * @example
     * ```typescript
     * if (fx < 1 || fx > 8) {
     *     return {
     *         content: [{ type: 'text', text: X32Error.invalidFx(fx) }],
     *         isError: true
     *     };
     * }
     * ```
     */
    static invalidFx(fx: number): string {
        return `Invalid FX rack: ${fx}. Must be 1-8.`;
    }

    /**
     * Returns error message for dB value out of valid range
     *
     * @param value - The invalid dB value that was provided
     * @returns Formatted error message with valid range and unity gain reference
     *
     * @example
     * ```typescript
     * if (unit === 'db') {
     *     if (value < -90 || value > 10) {
     *         return {
     *             content: [{ type: 'text', text: X32Error.invalidDb(value) }],
     *             isError: true
     *         };
     *     }
     * }
     * ```
     */
    static invalidDb(value: number): string {
        return `Invalid dB value: ${value}. Must be between -90 and +10 dB.
Unity gain = 0 dB.`;
    }

    /**
     * Returns error message for linear value out of valid range
     *
     * @param value - The invalid linear value that was provided
     * @returns Formatted error message with valid range and unity gain reference
     *
     * @example
     * ```typescript
     * if (unit === 'linear') {
     *     if (value < 0 || value > 1) {
     *         return {
     *             content: [{ type: 'text', text: X32Error.invalidLinear(value) }],
     *             isError: true
     *         };
     *     }
     * }
     * ```
     */
    static invalidLinear(value: number): string {
        return `Invalid linear value: ${value}. Must be between 0.0 and 1.0.
Unity gain = 0.75.`;
    }

    /**
     * Returns error message for connection failures with troubleshooting steps
     *
     * @param host - The host/IP address that failed to connect
     * @param port - The port number that was attempted
     * @param error - The underlying error message
     * @returns Formatted error message with troubleshooting checklist
     *
     * @example
     * ```typescript
     * try {
     *     await connection.connect({ host, port });
     * } catch (error) {
     *     return {
     *         content: [{
     *             type: 'text',
     *             text: X32Error.connectionFailed(host, port, error.message)
     *         }],
     *         isError: true
     *     };
     * }
     * ```
     */
    static connectionFailed(host: string, port: number, error: string): string {
        return `Failed to connect to ${host}:${port}

Error: ${error}

Check:
1. Mixer is powered on
2. IP address is correct
3. Network connection
4. Port ${port} is not blocked`;
    }

    /**
     * Returns error message for OSC operation failures
     *
     * @param operation - Description of the operation that failed (e.g., "set channel volume")
     * @param error - The error object or message from the failed operation
     * @returns Formatted error message with operation context
     *
     * @example
     * ```typescript
     * try {
     *     await connection.setChannelParameter(channel, 'mix/fader', value);
     * } catch (error) {
     *     return {
     *         content: [{
     *             type: 'text',
     *             text: X32Error.oscFailed('set channel volume', error)
     *         }],
     *         isError: true
     *     };
     * }
     * ```
     *
     * @remarks
     * This is a catch-all for OSC communication errors that don't fit other categories.
     * The error parameter accepts `unknown` type to handle various error formats from the OSC library.
     */
    static oscFailed(operation: string, error: unknown): string {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Failed to ${operation}: ${errorMsg}`;
    }
}
