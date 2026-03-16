import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { createErrorResult, createStructuredTextResult } from './tool-response.js';

type FxSetParameterArgs = {
    fx: number;
    parameter: number;
    value: number;
};
type FxGetStateArgs = {
    fx: number;
};
type FxBypassArgs = {
    fx: number;
    bypass: boolean;
};

const fxStateOutputSchema = z.object({
    fx: z.number(),
    type: z.number(),
    parameters: z.record(z.number())
});

/**
 * FX (effects) domain tools
 * Semantic, task-based tools for effects rack control
 */

/**
 * Register fx_set_parameter tool
 * Set effects parameter value
 */
function registerFxSetParameterTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'fx_set_parameter',
        {
            title: 'Set FX Parameter',
            description:
                'Set a parameter value for a specific effects rack on the X32/M32 mixer. The X32/M32 has 8 effects racks (1-8), each with multiple parameters (01-64). Parameter numbers and ranges vary by effect type.',
            inputSchema: z.object({
                fx: z.number().min(1).max(8).describe('Effects rack number from 1 to 8'),
                parameter: z.number().min(1).max(64).describe('Parameter number from 1 to 64 (valid range depends on effect type)'),
                value: z.number().min(0).max(1).describe('Parameter value from 0.0 to 1.0 (interpretation depends on parameter type)')
            }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ fx, parameter, value }: FxSetParameterArgs): Promise<CallToolResult> => {
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
                // Validate value range
                if (value < 0 || value > 1) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Invalid parameter value: ${value}. Must be between 0.0 and 1.0.\n\nFX parameters use normalized values:\n- 0.0 = minimum parameter value\n- 1.0 = maximum parameter value\n- Interpretation varies by parameter type (time, level, frequency, etc.)\n\nTo adjust this parameter:\n1. Ensure value is in 0.0-1.0 range\n2. Use fx_get_state to see current parameter values\n3. Consult X32/M32 effect documentation for parameter meanings`
                            }
                        ],
                        isError: true
                    };
                }

                // Format parameter number with leading zero (01-64)
                const paramNum = parameter.toString().padStart(2, '0');
                const address = `/fx/${fx}/par/${paramNum}`;

                await connection.setParameter(address, value);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Set FX ${fx} parameter ${paramNum} to ${value.toFixed(3)}`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to set FX parameter: ${errorMsg}\n\nFX Rack Overview:\n- The X32/M32 has 8 effects racks numbered 1-8\n- Each rack has a specific effect type loaded\n- Parameters 1-64 are available, but valid range depends on effect type\n- Not all parameters are used by every effect\n\nTroubleshooting:\n1. Verify FX rack ${fx} exists (valid: 1-8)\n2. Check parameter ${parameter} is valid for the current effect type\n3. Use fx_get_state tool to see current effect configuration\n4. Consult X32/M32 documentation for effect-specific parameter mappings`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register fx_get_state tool
 * Get effects rack state information
 */
function registerFxGetStateTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'fx_get_state',
        {
            title: 'Get FX State',
            description:
                'Get the current state of a specific effects rack on the X32/M32 mixer. Returns the effect type and parameter values.',
            inputSchema: {
                fx: z.number().min(1).max(8).describe('Effects rack number from 1 to 8')
            },
            outputSchema: fxStateOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ fx }: FxGetStateArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult('Not connected to X32/M32 mixer. Use connection_connect first.');
            }

            try {
                // Get effect type
                const typeAddress = `/fx/${fx}/type`;
                const type = await connection.getParameter<number>(typeAddress);

                // Get a few common parameters (first 6)
                const parameters: Record<string, number> = {};
                for (let i = 1; i <= 6; i++) {
                    const paramNum = i.toString().padStart(2, '0');
                    const paramAddress = `/fx/${fx}/par/${paramNum}`;
                    try {
                        parameters[paramNum] = await connection.getParameter<number>(paramAddress);
                    } catch {
                        // Parameter might not exist for this effect type
                        parameters[paramNum] = 0;
                    }
                }

                const paramList = Object.entries(parameters)
                    .map(([num, val]) => `  Par ${num}: ${val.toFixed(3)}`)
                    .join('\n');

                const state = {
                    fx,
                    type,
                    parameters
                };

                return createStructuredTextResult(`FX ${fx} State:\n  Type: ${type}\n${paramList}`, state);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return createErrorResult(
                    `Failed to get FX state: ${errorMsg}\n\nFX Rack System:\n- X32/M32 provides 8 independent effects racks (1-8)\n- Each rack can load different effect types (reverb, delay, chorus, etc.)\n- Effect type determines which parameters are active\n- Parameters vary by effect: some use 6, others up to 64\n\nTroubleshooting:\n1. Verify FX rack number is 1-8 (you specified: ${fx})\n2. Ensure mixer connection is active\n3. Check that mixer is responding to OSC commands\n4. Try a different FX rack number if this one is not responding`
                );
            }
        }
    );
}

/**
 * Register fx_bypass tool
 * Bypass or enable an effects rack
 */
function registerFxBypassTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'fx_bypass',
        {
            title: 'FX Bypass Control',
            description:
                'Bypass or enable a specific effects rack on the X32/M32 mixer. Bypassing an effect allows the audio to pass through unprocessed while retaining the effect settings.',
            inputSchema: {
                fx: z.number().min(1).max(8).describe('Effects rack number from 1 to 8'),
                bypass: z.boolean().describe('True to bypass the effect, false to enable')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ fx, bypass }: FxBypassArgs): Promise<CallToolResult> => {
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
                // X32 uses /fx/X/par/02 for bypass (0 = enabled, 1 = bypassed for most effects)
                const address = `/fx/${fx}/par/02`;
                const bypassValue = bypass ? 1 : 0;

                await connection.setParameter(address, bypassValue);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `FX ${fx} ${bypass ? 'bypassed' : 'enabled'}`
                        }
                    ]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to ${bypass ? 'bypass' : 'enable'} FX: ${errorMsg}\n\nFX Bypass Control:\n- Bypass allows audio to pass through unprocessed\n- Effect settings are retained when bypassed\n- Commonly used for A/B comparison or temporary disable\n- Uses parameter 02 for most effect types (0=enabled, 1=bypassed)\n\nTroubleshooting:\n1. Verify FX rack ${fx} is valid (1-8)\n2. Some effects may use different parameter for bypass\n3. Use fx_get_state to see current effect configuration\n4. Try fx_set_parameter with parameter 2 for manual bypass control`
                        }
                    ],
                    isError: true
                };
            }
        }
    );
}

/**
 * Register all FX domain tools
 */
export function registerFxTools(server: McpServer, connection: X32Connection): void {
    registerFxSetParameterTool(server, connection);
    registerFxGetStateTool(server, connection);
    registerFxBypassTool(server, connection);
}
