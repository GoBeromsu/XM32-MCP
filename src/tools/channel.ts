import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { faderToDb, formatDb } from '../utils/db-converter.js';
import { getColorValue, getColorName, getAvailableColors } from '../utils/color-converter.js';
import { parsePan, formatPan, panToPercent } from '../utils/pan-converter.js';
import { X32Error } from '../utils/error-helper.js';
import { createErrorResult, createStructuredTextResult } from './tool-response.js';
import { volumeUnitSchema, resolveVolume, resolveGain, type VolumeUnit } from './schemas.js';
type ChannelSetVolumeArgs = {
    channel: number;
    value: number;
    unit?: VolumeUnit;
};
type ChannelSetGainArgs = {
    channel: number;
    gain: number;
    unit?: VolumeUnit;
};
type ChannelMuteArgs = {
    channel: number;
    mute: boolean;
};
type ChannelSoloArgs = {
    channel: number;
    solo: boolean;
};
type ChannelSetEqBandArgs = {
    channel: number;
    band: number;
    frequency?: number;
    gain?: number;
    q?: number;
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
type ChannelGetStateArgs = {
    channel: number;
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
    server.registerTool(
        'channel_set_volume',
        {
            title: 'Set Channel Fader Volume',
            description:
                'Set the fader level (volume) for a specific input channel on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
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
        async ({ channel, value, unit = 'linear' }: ChannelSetVolumeArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveVolume(value, unit, [-90, 10]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                await connection.setChannelParameter(channel, 'mix/fader', resolved.linear);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} to ${formatDb(resolved.db)} (linear: ${resolved.linear.toFixed(3)})`
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
    server.registerTool(
        'channel_set_gain',
        {
            title: 'Set Channel Preamp Gain',
            description:
                'Set the preamp gain for a specific input channel on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-12 to +60 dB). This controls the input gain stage before the channel processing.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                gain: z.number().describe('Gain value (interpretation depends on unit parameter)'),
                unit: volumeUnitSchema('-12 to +60 dB')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, gain, unit = 'linear' }: ChannelSetGainArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveGain(gain, unit, [-12, 60]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                await connection.setChannelParameter(channel, 'head/gain', resolved.linear);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} preamp gain to ${resolved.db.toFixed(1)} dB (linear: ${resolved.linear.toFixed(3)})`
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
    server.registerTool(
        'channel_mute',
        {
            title: 'Channel Mute Control',
            description: 'Mute or unmute a specific input channel on the X32/M32 mixer. This controls the channel on/off state.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                mute: z.boolean().describe('True to mute the channel, false to unmute')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, mute }: ChannelMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = mute ? 0 : 1;
                await connection.setChannelParameter(channel, 'mix/on', onValue);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Channel ${channel} ${mute ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${mute ? 'mute' : 'unmute'} channel: ${error instanceof Error ? error.message : String(error)}`
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
    server.registerTool(
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
                return createErrorResult(X32Error.notConnected());
            }

            try {
                await connection.setChannelSolo(channel, solo);
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
 * Register channel_get_state tool
 * Get complete channel state
 */
function registerChannelGetStateTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'channel_get_state',
        {
            title: 'Get Channel State',
            description:
                'Get the complete state of an input channel including label, color, fader level, mute state, solo state, and pan position. Returns both machine-readable values and human-readable summaries.',
            inputSchema: {
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32')
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel }: ChannelGetStateArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const [name, colorValue, fader, on, pan, soloResult] = await Promise.allSettled([
                    connection.getChannelParameter<string>(channel, 'config/name'),
                    connection.getChannelParameter<number>(channel, 'config/color'),
                    connection.getChannelParameter<number>(channel, 'mix/fader'),
                    connection.getChannelParameter<number>(channel, 'mix/on'),
                    connection.getChannelParameter<number>(channel, 'mix/pan'),
                    connection.getChannelSolo(channel)
                ]);

                const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
                    r.status === 'fulfilled' ? r.value : fallback;

                const faderVal = val(fader, 0);
                const onVal = val(on, 1);
                const panVal = val(pan, 0.5);
                const rawDbValue = faderToDb(faderVal);
                const dbValue = Number.isFinite(rawDbValue) ? rawDbValue : null;
                const channelState = {
                    channel,
                    name: val(name, ''),
                    color: {
                        value: val(colorValue, 0),
                        name: getColorName(val(colorValue, 0)) || null
                    },
                    fader: {
                        linear: faderVal,
                        db: dbValue,
                        formatted: formatDb(rawDbValue)
                    },
                    muted: onVal === 0,
                    solo: val(soloResult, 0) === 1,
                    pan: {
                        linear: panVal,
                        formatted: formatPan(panVal),
                        percent: panToPercent(panVal)
                    }
                };

                const summary = [
                    `Channel ${channel} state:`,
                    `  Name: ${channelState.name}`,
                    `  Color: ${channelState.color.name ?? channelState.color.value}`,
                    `  Fader: ${channelState.fader.formatted} (linear: ${channelState.fader.linear.toFixed(3)})`,
                    `  Status: ${channelState.muted ? 'MUTED' : 'ACTIVE'}`,
                    `  Solo: ${channelState.solo ? 'ON' : 'OFF'}`,
                    `  Pan: ${channelState.pan.formatted} (${channelState.pan.percent > 0 ? '+' : ''}${channelState.pan.percent.toFixed(0)}%)`
                ].join('\n');

                return createStructuredTextResult(summary, channelState);
            } catch (error) {
                return createErrorResult(`Failed to get channel state: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    );
}

/**
 * Register channel_set_eq_band tool
 * Set specific EQ band parameters
 */
function registerChannelSetEqBandTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'channel_set_eq_band',
        {
            title: 'Set Channel EQ Band',
            description:
                'Configure a specific EQ band on an input channel. The X32/M32 has 4 parametric EQ bands per channel. You can set one or more parameters (frequency, gain, q) in a single call.',
            inputSchema: z.object({
                channel: z.number().min(1).max(32).describe('Input channel number from 1 to 32'),
                band: z.number().min(1).max(4).describe('EQ band number from 1 to 4'),
                frequency: z.number().optional().describe('Frequency value (0.0-1.0, maps to 20Hz-20kHz)'),
                gain: z.number().optional().describe('Gain value (0.0-1.0, maps to -15 to +15 dB)'),
                q: z.number().optional().describe('Q/bandwidth value (0.0-1.0)')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ channel, band, frequency, gain, q }: ChannelSetEqBandArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const params: Array<{ path: string; value: number; name: string }> = [];
                if (frequency !== undefined) params.push({ path: `eq/${band}/f`, value: frequency, name: 'frequency' });
                if (gain !== undefined) params.push({ path: `eq/${band}/g`, value: gain, name: 'gain' });
                if (q !== undefined) params.push({ path: `eq/${band}/q`, value: q, name: 'Q/width' });

                if (params.length === 0) {
                    return createErrorResult('At least one of frequency, gain, or q must be provided.');
                }

                await Promise.all(params.map(p =>
                    connection.setChannelParameter(channel, p.path, p.value)
                ));

                const summary = params.map(p => `${p.name}=${p.value}`).join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set channel ${channel} EQ band ${band}: ${summary}`
                        }
                    ]
                };
            } catch (error) {
                return createErrorResult(`Failed to set EQ band: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    );
}

/**
 * Register channel_set_name tool
 * Set channel name/label
 */
function registerChannelSetNameTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
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
                return createErrorResult(X32Error.notConnected());
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
    server.registerTool(
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
                return createErrorResult(X32Error.notConnected());
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
    server.registerTool(
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
                return createErrorResult(X32Error.notConnected());
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
    registerChannelGetStateTool(server, connection);
    registerChannelSetEqBandTool(server, connection);
    registerChannelSetNameTool(server, connection);
    registerChannelSetColorTool(server, connection);
    registerChannelSetPanTool(server, connection);
}
