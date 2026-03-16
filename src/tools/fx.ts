import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { X32Error } from '../utils/error-helper.js';
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
                return createErrorResult(X32Error.notConnected());
            }

            try {
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
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ fx }: FxGetStateArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult(X32Error.notConnected());
            }

            try {
                // Get effect type
                const typeAddress = `/fx/${fx}/type`;
                const type = await connection.getParameter<number>(typeAddress);

                // Get common parameters (first 6) in parallel
                const paramNums = Array.from({ length: 6 }, (_, i) => (i + 1).toString().padStart(2, '0'));
                const results = await Promise.allSettled(
                    paramNums.map(num => connection.getParameter<number>(`/fx/${fx}/par/${num}`))
                );
                const parameters: Record<string, number> = {};
                results.forEach((r, i) => {
                    parameters[paramNums[i]] = r.status === 'fulfilled' ? r.value : 0;
                });

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
                return createErrorResult(X32Error.notConnected());
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
