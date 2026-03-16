import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { dbToFader, faderToDb, formatDb } from '../utils/db-converter.js';

type RegisterTool = (name: string, config: unknown, handler: unknown) => void;
type VolumeUnit = 'linear' | 'db';
type BusSetVolumeArgs = {
    bus: number;
    value: number;
    unit?: VolumeUnit;
};
type BusMuteArgs = {
    bus: number;
    muted: boolean;
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
    (server.registerTool as RegisterTool)(
        'bus_set_volume',
        {
            title: 'Set Bus Fader Volume',
            description:
                'Set the fader level (volume) for a specific mix bus on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                value: z.number().describe('Volume value (interpretation depends on unit parameter)'),
                unit: z
                    .enum(['linear', 'db'])
                    .default('linear')
                    .describe('Unit of the value: "linear" (0.0-1.0) or "db" (-90 to +10 dB). Default is "linear".')
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
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. First, establish connection using connection_connect tool with parameters:\n  - host: IP address of mixer (e.g., "192.168.1.100")\n  - port: OSC port, typically 10023\n\nExample: connection_connect with host="192.168.1.100" and port=10023'
                        }
                    ],
                    isError: true
                };
            }

            try {
                let faderValue: number;
                let dbValue: number;

                if (unit === 'db') {
                    // Input is in dB
                    if (value < -90 || value > 10) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Invalid dB value: ${value} dB. Must be between -90 and +10 dB.\n\nValid range:\n  - Minimum: -90 dB (silence)\n  - Unity gain: 0 dB (no boost/cut)\n  - Maximum: +10 dB (boost)\n\nExamples:\n  - Set to -6 dB: value=-6, unit="db"\n  - Set to unity: value=0, unit="db"\n  - Set to +3 dB: value=3, unit="db"`
                                }
                            ],
                            isError: true
                        };
                    }
                    dbValue = value;
                    faderValue = dbToFader(value);
                } else {
                    // Input is linear
                    if (value < 0 || value > 1) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Invalid linear value: ${value}. Must be between 0.0 and 1.0.\n\nLinear scale explanation:\n  - 0.0 = -∞ dB (silence)\n  - 0.75 = 0 dB (unity gain, no boost/cut)\n  - 1.0 = +10 dB (maximum)\n\nExamples:\n  - Set to silence: value=0.0\n  - Set to unity gain: value=0.75\n  - Set to half volume: value=0.5\n\nAlternatively, use unit="db" for decibel values (-90 to +10 dB).`
                                }
                            ],
                            isError: true
                        };
                    }
                    faderValue = value;
                    dbValue = faderToDb(value);
                }

                await connection.setBusParameter(bus, 'mix/fader', faderValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set bus ${bus} to ${formatDb(dbValue)} (linear: ${faderValue.toFixed(3)})`
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
    (server.registerTool as RegisterTool)(
        'bus_mute',
        {
            title: 'Bus Mute Control',
            description: 'Mute or unmute a specific mix bus on the X32/M32 mixer. This controls the bus on/off state.',
            inputSchema: {
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                muted: z.boolean().describe('True to mute the bus, false to unmute')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ bus, muted }: BusMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. First, establish connection using connection_connect tool with parameters:\n  - host: IP address of mixer (e.g., "192.168.1.100")\n  - port: OSC port, typically 10023\n\nExample: connection_connect with host="192.168.1.100" and port=10023'
                        }
                    ],
                    isError: true
                };
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = muted ? 0 : 1;
                await connection.setBusParameter(bus, 'mix/on', onValue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Bus ${bus} ${muted ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${muted ? 'mute' : 'unmute'} bus: ${error instanceof Error ? error.message : String(error)}`
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
    (server.registerTool as RegisterTool)(
        'bus_set_send',
        {
            title: 'Set Channel Send to Bus',
            description:
                'Set the send level from a channel to a mix bus. This controls how much of the channel signal is sent to the bus. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB).',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                bus: z.number().min(1).max(16).describe('Mix bus number from 1 to 16'),
                value: z.number().describe('Send level value (interpretation depends on unit parameter)'),
                unit: z
                    .enum(['linear', 'db'])
                    .default('linear')
                    .describe('Unit of the value: "linear" (0.0-1.0) or "db" (-90 to +10 dB). Default is "linear".')
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
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. First, establish connection using connection_connect tool with parameters:\n  - host: IP address of mixer (e.g., "192.168.1.100")\n  - port: OSC port, typically 10023\n\nExample: connection_connect with host="192.168.1.100" and port=10023'
                        }
                    ],
                    isError: true
                };
            }

            try {
                let faderValue: number;
                let dbValue: number;

                if (unit === 'db') {
                    // Input is in dB
                    if (value < -90 || value > 10) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Invalid dB value: ${value} dB. Must be between -90 and +10 dB.\n\nValid range:\n  - Minimum: -90 dB (silence/off)\n  - Unity gain: 0 dB (no boost/cut)\n  - Maximum: +10 dB (boost)\n\nExamples:\n  - Silence send: value=-90, unit="db"\n  - Unity send: value=0, unit="db"\n  - Boost send: value=3, unit="db"`
                                }
                            ],
                            isError: true
                        };
                    }
                    dbValue = value;
                    faderValue = dbToFader(value);
                } else {
                    // Input is linear
                    if (value < 0 || value > 1) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Invalid linear value: ${value}. Must be between 0.0 and 1.0.\n\nLinear scale explanation:\n  - 0.0 = -∞ dB (no send signal)\n  - 0.75 = 0 dB (unity send level)\n  - 1.0 = +10 dB (maximum send)\n\nExamples:\n  - No send: value=0.0\n  - Unity send: value=0.75\n  - Half send: value=0.5\n\nAlternatively, use unit="db" for decibel values (-90 to +10 dB).`
                                }
                            ],
                            isError: true
                        };
                    }
                    faderValue = value;
                    dbValue = faderToDb(value);
                }

                // Channel send to bus: /ch/[channel]/mix/[bus]/level
                const ch = channel.toString().padStart(2, '0');
                const busNum = bus.toString().padStart(2, '0');
                const address = `/ch/${ch}/mix/${busNum}/level`;

                await connection.setParameter(address, faderValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} send to bus ${bus} to ${formatDb(dbValue)} (linear: ${faderValue.toFixed(3)})`
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
    (server.registerTool as RegisterTool)(
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
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. First, establish connection using connection_connect tool with parameters:\n  - host: IP address of mixer (e.g., "192.168.1.100")\n  - port: OSC port, typically 10023\n\nExample: connection_connect with host="192.168.1.100" and port=10023'
                        }
                    ],
                    isError: true
                };
            }

            try {
                // Get bus parameters
                const fader = await connection.getBusParameter<number>(bus, 'mix/fader');
                const on = await connection.getBusParameter<number>(bus, 'mix/on');
                const pan = await connection.getBusParameter<number>(bus, 'mix/pan');

                // Optional parameters that may not be available on all buses
                let name = '';
                let color = -1;

                try {
                    name = await connection.getBusParameter<string>(bus, 'config/name');
                } catch {
                    // Name not available
                }

                try {
                    color = await connection.getBusParameter<number>(bus, 'config/color');
                } catch {
                    // Color not available
                }

                // Convert values to human-readable formats
                const dbValue = faderToDb(fader);
                const muted = on === 0;

                // Build state response
                let stateText = `Bus ${bus} state:\n`;
                if (name) {
                    stateText += `  Name: ${name}\n`;
                }
                stateText += `  Fader: ${formatDb(dbValue)} (linear: ${fader.toFixed(3)})\n`;
                stateText += `  Status: ${muted ? 'MUTED' : 'ACTIVE'}\n`;
                stateText += `  Pan: ${pan.toFixed(3)}`;
                if (color >= 0) {
                    stateText += `\n  Color: ${color}`;
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: stateText
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to get bus state: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
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
