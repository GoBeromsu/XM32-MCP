import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { dbToFader, faderToDb, formatDb } from '../utils/db-converter.js';

type RegisterTool = (name: string, config: unknown, handler: unknown) => void;
type VolumeUnit = 'linear' | 'db';
type OutputLevelArgs = {
    value: number;
    unit?: VolumeUnit;
};
type MainMuteArgs = {
    muted: boolean;
};

/**
 * Main output domain tools
 * Semantic, task-based tools for main and monitor output control
 */

/**
 * Register main_set_volume tool
 * Set main stereo output volume
 */
function registerMainSetVolumeTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'main_set_volume',
        {
            title: 'Set Main Stereo Output Volume',
            description:
                'Set the main stereo output fader level on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
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
        async ({ value, unit = 'linear' }: OutputLevelArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. Use connection_connect first.'
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
                                    text: `Invalid dB value: ${value}. Must be between -90 and +10 dB.\n\nWARNING: Main output controls the primary mixer output.\n\nValid dB range:\n- -90 dB = minimum/silence\n- 0 dB = unity gain (0.75 linear)\n- +10 dB = maximum output\n\nSafety considerations:\n1. Start with low values when testing\n2. Sudden volume changes can damage speakers or hearing\n3. Consider using monitor outputs for testing instead\n4. Use channel/bus controls for most mixing tasks`
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
                                    text: `Invalid linear value: ${value}. Must be between 0.0 and 1.0.\n\nWARNING: Main output controls the primary mixer output.\n\nValid linear range:\n- 0.0 = silence\n- 0.75 = unity gain (0 dB)\n- 1.0 = maximum (+10 dB)\n\nSafety considerations:\n1. Start with low values (< 0.5) when testing\n2. Sudden volume changes can damage speakers or hearing\n3. Consider using monitor outputs for testing instead\n4. Use channel/bus controls for most mixing tasks`
                                }
                            ],
                            isError: true
                        };
                    }
                    faderValue = value;
                    dbValue = faderToDb(value);
                }

                await connection.setParameter('/main/st/mix/fader', faderValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set main stereo output to ${formatDb(dbValue)} (linear: ${faderValue.toFixed(3)})`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set main volume: ${errorMsg}\n\nCRITICAL: Main output controls affect the primary mixer output.\n\nMain vs Monitor:\n- Main (/main/st) = Primary house/PA output to speakers\n- Monitor (/main/m) = Engineer monitoring/headphones\n- Changing main affects audience, not just monitoring\n\nTroubleshooting:\n1. Verify mixer connection is active\n2. Check if main output is muted (use main_mute to check)\n3. Consider using monitor_set_level for testing\n4. Ensure value is in valid range\n5. Try channel_set_volume for individual channel control`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register main_mute tool
 * Mute or unmute main stereo output
 */
function registerMainMuteTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'main_mute',
        {
            title: 'Main Stereo Output Mute Control',
            description: 'Mute or unmute the main stereo output on the X32/M32 mixer. This controls the master output on/off state.',
            inputSchema: z.object({
                muted: z.boolean().describe('True to mute the main output, false to unmute')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: true, // Muting main output is potentially destructive
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ muted }: MainMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. Use connection_connect first.'
                        }
                    ],
                    isError: true
                };
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = muted ? 0 : 1;
                await connection.setParameter('/main/st/mix/on', onValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Main stereo output ${muted ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${muted ? 'mute' : 'unmute'} main output: ${errorMsg}\n\nCRITICAL: Muting main output affects the primary house/PA speakers.\n\nMain Output Control:\n- Muting stops all sound to main speakers\n- Used for emergency silence or show transitions\n- Does NOT affect monitor outputs\n- X32 uses inverted logic: 0=muted, 1=unmuted\n\nWarning when unmuting:\n- Check main volume level first (use main_set_volume)\n- Ensure volume is at safe level before unmuting\n- Sudden loud unmute can damage speakers or hearing\n\nTroubleshooting:\n1. Verify mixer connection is active\n2. Check OSC communication is working\n3. Try setting main volume to confirm control path works`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register monitor_set_level tool
 * Set monitor output level
 */
function registerMonitorSetLevelTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'monitor_set_level',
        {
            title: 'Set Monitor Output Level',
            description:
                'Set the monitor output fader level on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: {
                value: z.number().describe('Volume value (interpretation depends on unit parameter)'),
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
        async ({ value, unit = 'linear' }: OutputLevelArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Not connected to X32/M32 mixer. Use connection_connect first.'
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
                                    text: `Invalid dB value: ${value}. Must be between -90 and +10 dB.\n\nMonitor Output Control:\n- Monitor output (/main/m) is for engineer monitoring only\n- Does NOT affect main house/PA speakers\n- Safe for testing without affecting audience\n\nValid dB range:\n- -90 dB = minimum/silence\n- 0 dB = unity gain (0.75 linear)\n- +10 dB = maximum output\n\nRecommendation:\n- Start with -20 dB for safe headphone monitoring\n- Increase gradually to comfortable listening level`
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
                                    text: `Invalid linear value: ${value}. Must be between 0.0 and 1.0.\n\nMonitor Output Control:\n- Monitor output (/main/m) is for engineer monitoring only\n- Does NOT affect main house/PA speakers\n- Safe for testing without affecting audience\n\nValid linear range:\n- 0.0 = silence\n- 0.75 = unity gain (0 dB)\n- 1.0 = maximum (+10 dB)\n\nRecommendation:\n- Start with 0.3-0.4 for safe headphone monitoring\n- Increase gradually to comfortable listening level`
                                }
                            ],
                            isError: true
                        };
                    }
                    faderValue = value;
                    dbValue = faderToDb(value);
                }

                await connection.setParameter('/main/m/mix/fader', faderValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set monitor output to ${formatDb(dbValue)} (linear: ${faderValue.toFixed(3)})`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set monitor level: ${errorMsg}\n\nMonitor vs Main Output:\n- Monitor (/main/m) = Engineer monitoring output (headphones/near-field)\n- Main (/main/st) = Primary house/PA output to speakers\n- Monitor is safe for testing, does not affect audience\n\nMonitor Output Uses:\n- Solo bus monitoring\n- Cue/preview before sending to main\n- Engineer headphone mix\n- Control room monitoring\n\nTroubleshooting:\n1. Verify mixer connection is active\n2. Check that monitor output is configured\n3. Ensure monitor routing is set up correctly\n4. Try main_set_volume if you intended to control main output`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register all main/monitor domain tools
 */
export function registerMainTools(server: McpServer, connection: X32Connection): void {
    registerMainSetVolumeTool(server, connection);
    registerMainMuteTool(server, connection);
    registerMonitorSetLevelTool(server, connection);
}
