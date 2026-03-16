import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { faderToDb, formatDb } from '../utils/db-converter.js';
import { X32Error } from '../utils/error-helper.js';
import { createErrorResult, createStructuredTextResult } from './tool-response.js';
import { volumeUnitSchema, resolveVolume, type VolumeUnit } from './schemas.js';
type BusSetVolumeArgs = {
    bus: number;
    value: number;
    unit?: VolumeUnit;
};
type BusMuteArgs = {
    bus: number;
    mute: boolean;
};
type BusSetSendArgs = {
    channel: number;
    bus: number;
    value: number;
    unit?: VolumeUnit;
};
type BusGetStateArgs = {
    bus: number;
};

/**
 * Bus domain tools
 * Semantic, task-based tools for mix bus control
 */

/**
 * Register bus_set_volume tool
 * Set bus fader level
 */
function registerBusSetVolumeTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'bus_set_volume',
        {
            title: 'Set Bus Fader Volume',
            description:
                'Set the fader level (volume) for a specific mix bus on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                value: z.number().describe('Volume value (interpretation depends on unit parameter)'),
                unit: volumeUnitSchema('-90 to +10 dB')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ bus, value, unit = 'linear' }: BusSetVolumeArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveVolume(value, unit, [-90, 10]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                await connection.setBusParameter(bus, 'mix/fader', resolved.linear);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set bus ${bus} to ${formatDb(resolved.db)} (linear: ${resolved.linear.toFixed(3)})`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set bus volume: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register bus_mute tool
 * Mute or unmute a bus
 */
function registerBusMuteTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'bus_mute',
        {
            title: 'Bus Mute Control',
            description: 'Mute or unmute a specific mix bus on the X32/M32 mixer. This controls the bus on/off state.',
            inputSchema: {
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                mute: z.boolean().describe('True to mute the bus, false to unmute')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ bus, mute }: BusMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = mute ? 0 : 1;
                await connection.setBusParameter(bus, 'mix/on', onValue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Bus ${bus} ${mute ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${mute ? 'mute' : 'unmute'} bus: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register bus_set_send tool
 * Set channel send level to a bus
 */
function registerBusSetSendTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'bus_set_send',
        {
            title: 'Set Channel Send to Bus',
            description:
                'Set the send level from a channel to a mix bus. This controls how much of the channel signal is sent to the bus. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB).',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                value: z.number().describe('Send level value (interpretation depends on unit parameter)'),
                unit: volumeUnitSchema('-90 to +10 dB')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, bus, value, unit = 'linear' }: BusSetSendArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveVolume(value, unit, [-90, 10]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                // Channel send to bus: /ch/[channel]/mix/[bus]/level
                const ch = channel.toString().padStart(2, '0');
                const busNum = bus.toString().padStart(2, '0');
                const address = `/ch/${ch}/mix/${busNum}/level`;

                await connection.setParameter(address, resolved.linear);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} send to bus ${bus} to ${formatDb(resolved.db)} (linear: ${resolved.linear.toFixed(3)})`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel send: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register bus_get_state tool
 * Get complete bus state
 */
function registerBusGetStateTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'bus_get_state',
        {
            title: 'Get Bus State',
            description:
                'Get the complete state of a mix bus including fader level, on/off status, and other key parameters. Returns all values in both linear and human-readable formats.',
            inputSchema: {
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16')
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ bus }: BusGetStateArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                // Get bus parameters in parallel (each is a UDP round trip)
                const [fader, on, pan] = await Promise.all([
                    connection.getBusParameter<number>(bus, 'mix/fader'),
                    connection.getBusParameter<number>(bus, 'mix/on'),
                    connection.getBusParameter<number>(bus, 'mix/pan')
                ]);

                // Optional parameters in parallel
                const [nameResult, colorResult] = await Promise.allSettled([
                    connection.getBusParameter<string>(bus, 'config/name'),
                    connection.getBusParameter<number>(bus, 'config/color')
                ]);
                const name = nameResult.status === 'fulfilled' ? nameResult.value : '';
                const color = colorResult.status === 'fulfilled' ? colorResult.value : -1;

                // Convert values to human-readable formats
                const rawDbValue = faderToDb(fader);
                const dbValue = Number.isFinite(rawDbValue) ? rawDbValue : null;
                const muted = on === 0;

                // Build state response
                const state = {
                    bus,
                    name: name || null,
                    color: color >= 0 ? color : null,
                    fader: {
                        linear: fader,
                        db: dbValue,
                        formatted: formatDb(rawDbValue)
                    },
                    muted,
                    pan
                };

                let summary = `Bus ${bus} state:\n`;
                if (state.name) {
                    summary += `  Name: ${state.name}\n`;
                }
                summary += `  Fader: ${state.fader.formatted} (linear: ${state.fader.linear.toFixed(3)})\n`;
                summary += `  Status: ${state.muted ? 'MUTED' : 'ACTIVE'}\n`;
                summary += `  Pan: ${state.pan.toFixed(3)}`;
                if (state.color !== null) {
                    summary += `\n  Color: ${state.color}`;
                }

                return createStructuredTextResult(summary, state);
            } catch (error) {
                return createErrorResult(`Failed to get bus state: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    );
}

/**
 * Register all bus domain tools
 */
export function registerBusTools(server: McpServer, connection: X32Connection): void {
    registerBusSetVolumeTool(server, connection);
    registerBusMuteTool(server, connection);
    registerBusSetSendTool(server, connection);
    registerBusGetStateTool(server, connection);
}
