import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { formatDb } from '../utils/db-converter.js';
import { X32Error } from '../utils/error-helper.js';
import { createErrorResult } from './tool-response.js';
import { volumeUnitSchema, resolveVolume, type VolumeUnit } from './schemas.js';
type OutputLevelArgs = {
    value: number;
    unit?: VolumeUnit;
};
type MainMuteArgs = {
    mute: boolean;
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
    server.registerTool(
        'main_set_volume',
        {
            title: 'Set Main Stereo Output Volume',
            description:
                'Set the main stereo output fader level on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: z.object({
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
        async ({ value, unit = 'linear' }: OutputLevelArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveVolume(value, unit, [-90, 10]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                await connection.setParameter('/main/st/mix/fader', resolved.linear);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set main stereo output to ${formatDb(resolved.db)} (linear: ${resolved.linear.toFixed(3)})`
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
    server.registerTool(
        'main_mute',
        {
            title: 'Main Stereo Output Mute Control',
            description: 'Mute or unmute the main stereo output on the X32/M32 mixer. This controls the master output on/off state.',
            inputSchema: z.object({
                mute: z.boolean().describe('True to mute the main output, false to unmute')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: true, // Muting main output is potentially destructive
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ mute }: MainMuteArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                // X32 uses inverted logic: 0 = muted, 1 = unmuted
                const onValue = mute ? 0 : 1;
                await connection.setParameter('/main/st/mix/on', onValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Main stereo output ${mute ? 'muted' : 'unmuted'}`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${mute ? 'mute' : 'unmute'} main output: ${errorMsg}\n\nCRITICAL: Muting main output affects the primary house/PA speakers.\n\nMain Output Control:\n- Muting stops all sound to main speakers\n- Used for emergency silence or show transitions\n- Does NOT affect monitor outputs\n- X32 uses inverted logic: 0=muted, 1=unmuted\n\nWarning when unmuting:\n- Check main volume level first (use main_set_volume)\n- Ensure volume is at safe level before unmuting\n- Sudden loud unmute can damage speakers or hearing\n\nTroubleshooting:\n1. Verify mixer connection is active\n2. Check OSC communication is working\n3. Try setting main volume to confirm control path works`
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
    server.registerTool(
        'monitor_set_level',
        {
            title: 'Set Monitor Output Level',
            description:
                'Set the monitor output fader level on the X32/M32 mixer. Supports both linear values (0.0-1.0) and decibel values (-90 to +10 dB). Unity gain is 0 dB or 0.75 linear.',
            inputSchema: {
                value: z.number().describe('Volume value (interpretation depends on unit parameter)'),
                unit: volumeUnitSchema('-90 to +10 dB')
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
                return createErrorResult(X32Error.notConnected());
            }

            try {
                const resolved = resolveVolume(value, unit, [-90, 10]);
                if ('error' in resolved) {
                    return createErrorResult(resolved.error);
                }

                await connection.setParameter('/main/m/mix/fader', resolved.linear);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set monitor output to ${formatDb(resolved.db)} (linear: ${resolved.linear.toFixed(3)})`
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
