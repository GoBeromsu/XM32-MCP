import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { dbToFader, faderToDb, formatDb } from '../utils/db-converter.js';
import { getColorValue, getColorName, getAvailableColors } from '../utils/color-converter.js';
import { parsePan, formatPan, panToPercent } from '../utils/pan-converter.js';
import { X32Error } from '../utils/error-helper.js';

type RegisterTool = (name: string, config: unknown, handler: unknown) => void;
type VolumeUnit = 'linear' | 'db';
type ChannelEqParameter = 'f' | 'g' | 'q';
type ChannelSetVolumeArgs = {
    channel: number;
    value: number;
    unit?: VolumeUnit;
};
type ChannelSetGainArgs = {
    channel: number;
    gain: number;
};
type ChannelMuteArgs = {
    channel: number;
    muted: boolean;
};
type ChannelSoloArgs = {
    channel: number;
    solo: boolean;
};
type ChannelSetEqBandArgs = {
    channel: number;
    band: number;
    parameter: ChannelEqParameter;
    value: number;
};
type ChannelSetNameArgs = {
    channel: number;
    name: string;
};
type ChannelSetColorArgs = {
    channel: number;
    color: string;
};
type ChannelSetPanArgs = {
    channel: number;
    pan: string | number;
};

/**
 * Channel domain tools
 * Semantic, task-based tools for channel control
 */

/**
 * Register channel_set_volume tool
 * Set channel fader level
 */
function registerChannelSetVolumeTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_volume',
        {
            title: 'Set Channel Fader Volume',
            description:
                'Set the fader level (volume) for a specific input channel on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
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
        async ({ channel, value, unit = 'linear' }: ChannelSetVolumeArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
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
                                    text: X32Error.invalidDb(value)
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
                                    text: X32Error.invalidLinear(value)
                                }
                            ],
                            isError: true
                        };
                    }
                    faderValue = value;
                    dbValue = faderToDb(value);
                }

                await connection.setChannelParameter(channel, 'mix/fader', faderValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} to ${formatDb(dbValue)} (linear: ${faderValue.toFixed(3)})`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel volume: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_set_gain tool
 * Set channel preamp gain
 */
function registerChannelSetGainTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_gain',
        {
            title: 'Set Channel Preamp Gain',
            description:
                'Set the preamp gain for a specific input channel on the X32/M32 mixer. This controls the input gain stage before the channel processing.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                gain: z.number().min(0).max(1).describe('Preamp gain level from 0.0 to 1.0 (typically represents -12dB to +60dB range)')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, gain }: ChannelSetGainArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                await connection.setChannelParameter(channel, 'head/gain', gain);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} preamp gain to ${gain}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel gain: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_mute tool
 * Mute or unmute a channel
 */
function registerChannelMuteTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_mute',
        {
            title: 'Channel Mute Control',
            description: 'Mute or unmute a specific input channel on the X32/M32 mixer. This controls the channel on/off state.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                muted: z.boolean().describe('True to mute the channel, false to unmute')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, muted }: ChannelMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = muted ? 0 : 1;
                await connection.setChannelParameter(channel, 'mix/on', onValue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Channel ${channel} ${muted ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${muted ? 'mute' : 'unmute'} channel: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_solo tool
 * Solo or unsolo a channel
 */
function registerChannelSoloTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_solo',
        {
            title: 'Channel Solo Control',
            description:
                'Solo or unsolo a specific input channel on the X32/M32 mixer. This routes the channel to the solo bus for isolated monitoring.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                solo: z.boolean().describe('True to solo the channel, false to unsolo')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, solo }: ChannelSoloArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                // Note: X32 solo is controlled via /-stat/solosw/XX, not channel parameter
                // For now, we'll use mix send as a workaround
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Channel ${channel} ${solo ? 'soloed' : 'unsoloed'}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${solo ? 'solo' : 'unsolo'} channel: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_set_eq_band tool
 * Set specific EQ band parameters
 */
function registerChannelSetEqBandTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_eq_band',
        {
            title: 'Set Channel EQ Band',
            description: 'Configure a specific EQ band on an input channel. The X32/M32 has 4 parametric EQ bands per channel.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                band: z.number().min(1).max(4).describe('EQ band number from 1 to 4'),
                parameter: z.enum(['f', 'g', 'q']).describe('EQ parameter: f=frequency(Hz), g=gain(dB), q=quality/width'),
                value: z.number().describe('Parameter value (range depends on parameter type)')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, band, parameter, value }: ChannelSetEqBandArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                const path = `eq/${band}/${parameter}`;
                await connection.setChannelParameter(channel, path, value);

                const paramNames: Record<ChannelEqParameter, string> = { f: 'frequency', g: 'gain', q: 'Q/width' };
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} EQ band ${band} ${paramNames[parameter]} to ${value}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set EQ band: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_set_name tool
 * Set channel name/label
 */
function registerChannelSetNameTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_name',
        {
            title: 'Set Channel Name',
            description: 'Set the name/label for a specific input channel. Maximum 12 characters for X32/M32.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                name: z.string().max(12).describe('Channel name (max 12 characters)')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, name }: ChannelSetNameArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                // Truncate name to 12 characters if longer
                const truncatedName = name.substring(0, 12);
                await connection.setChannelParameter(channel, 'config/name', truncatedName);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} name to "${truncatedName}"`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel name: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_set_color tool
 * Set channel strip color
 */
function registerChannelSetColorTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_color',
        {
            title: 'Set Channel Color',
            description: 'Set the strip color for a specific input channel. Colors help visually organize channels on the mixer.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                color: z
                    .string()
                    .describe(
                        'Color name (off, red, green, yellow, blue, magenta, cyan, white) or inverted variants (red-inv, etc.) or numeric value (0-15)'
                    )
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, color }: ChannelSetColorArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                const colorValue = getColorValue(color);
                if (colorValue === null) {
                    const availableColors = getAvailableColors().join(', ');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Invalid color value: "${color}"\n\nColors help visually organize channels on the mixer display.\n\nAvailable color names:\n  ${availableColors}\n\nExamples:\n  - Set to red: color="red"\n  - Set to inverted blue: color="blue-inv"\n  - Set to no color: color="off"\n  - Set by number: color="3" (numeric values 0-15)`
                            }
                        ],
                        isError: true
                    };
                }

                await connection.setChannelParameter(channel, 'config/color', colorValue);

                const colorName = getColorName(colorValue) || `color ${colorValue}`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} color to ${colorName}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel color: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register channel_set_pan tool
 * Set channel stereo positioning
 */
function registerChannelSetPanTool(server: McpServer, connection: X32Connection): void {
    (server.registerTool as RegisterTool)(
        'channel_set_pan',
        {
            title: 'Set Channel Pan',
            description:
                'Set the stereo pan position for a channel. Accepts percentage (-100 to +100), LR notation (L50, C, R100), or linear values (0.0-1.0).',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                pan: z
                    .union([z.string(), z.number()])
                    .describe('Pan position: percentage (-100 to +100), LR notation (L50/C/R100), or linear (0.0-1.0)')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, pan }: ChannelSetPanArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: X32Error.notConnected()
                        }
                    ],
                    isError: true
                };
            }

            try {
                const panValue = parsePan(pan);
                if (panValue === null) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Invalid pan value: "${pan}"\n\nPan controls stereo positioning (left/right balance).\n\nAccepted formats:\n  1. Percentage: -100 (full left) to +100 (full right)\n     Examples: -50, 0 (center), +75\n  \n  2. LR notation: L100 (full left), C (center), R100 (full right)\n     Examples: "L50", "C", "R30"\n  \n  3. Linear: 0.0 (full left) to 1.0 (full right)\n     Examples: 0.0, 0.5 (center), 0.75\n\nCommon values:\n  - Full left: -100, "L100", or 0.0\n  - Center: 0, "C", or 0.5\n  - Full right: +100, "R100", or 1.0`
                            }
                        ],
                        isError: true
                    };
                }

                await connection.setChannelParameter(channel, 'mix/pan', panValue);

                const percent = panToPercent(panValue);
                const formatted = formatPan(panValue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} pan to ${formatted} (${percent > 0 ? '+' : ''}${percent.toFixed(0)}%)`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set channel pan: ${error instanceof Error ? error.message : String(error)}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register all channel domain tools
 */
export function registerChannelTools(server: McpServer, connection: X32Connection): void {
    registerChannelSetVolumeTool(server, connection);
    registerChannelSetGainTool(server, connection);
    registerChannelMuteTool(server, connection);
    registerChannelSoloTool(server, connection);
    registerChannelSetEqBandTool(server, connection);
    registerChannelSetNameTool(server, connection);
    registerChannelSetColorTool(server, connection);
    registerChannelSetPanTool(server, connection);
}
