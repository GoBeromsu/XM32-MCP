import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { X32Connection } from '../services/x32-connection.js';
import { createErrorResult, createStructuredTextResult, createTextResult, normalizeOscValue } from './tool-response.js';

type GetParameterArgs = {
    address: string;
};
type SetParameterArgs = {
    address: string;
    value: string | number;
};

const getParameterOutputSchema = z.object({
    address: z.string(),
    valueType: z.enum(['string', 'number', 'boolean', 'buffer', 'array', 'object', 'null', 'unknown']),
    value: z.unknown()
});

function getOscValueType(value: unknown): 'string' | 'number' | 'boolean' | 'buffer' | 'array' | 'object' | 'null' | 'unknown' {
    if (value === null) {
        return 'null';
    }

    if (Buffer.isBuffer(value)) {
        return 'buffer';
    }

    if (Array.isArray(value)) {
        return 'array';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return typeof value;
    }

    if (typeof value === 'object') {
        return 'object';
    }

    return 'unknown';
}

/**
 * Generic parameter tools
 * Low-level fallback tools for advanced users
 */

/**
 * Register get_parameter tool
 * Gets parameter value by OSC address pattern
 */
function registerGetParameterTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'get_parameter',
        {
            title: 'Get Parameter (Low-Level)',
            description:
                'ADVANCED/LOW-LEVEL TOOL: Retrieves current parameter values from X32/M32 mixer using raw OSC address patterns. Consider using semantic tools (channel_*, bus_*, etc.) for common operations. Use this tool for parameters not covered by semantic tools or for debugging purposes.',
            inputSchema: {
                address: z
                    .string()
                    .describe(
                        'OSC address pattern for the parameter to read (e.g., "/ch/01/mix/fader" for channel 1 fader level, "/main/st/mix/fader" for main stereo fader, "/ch/01/eq/1/f" for channel 1 EQ band 1 frequency)'
                    )
            },
            outputSchema: getParameterOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async ({ address }: GetParameterArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult('Not connected to X32/M32 mixer. Use connection_connect first.');
            }

            try {
                const value = await connection.getParameter(address);
                const result = {
                    address,
                    valueType: getOscValueType(value),
                    value: normalizeOscValue(value)
                };

                return createStructuredTextResult(`${address} = ${JSON.stringify(result.value)}`, result);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return createErrorResult(
                    `Failed to get parameter: ${errorMsg}\n\nLOW-LEVEL TOOL: This is an advanced tool for direct OSC access.\n\nPrefer semantic tools:\n- Use channel_get_state instead of /ch/XX/... addresses\n- Use bus_get_state instead of /bus/XX/... addresses\n- Use fx_get_state instead of /fx/X/... addresses\n\nOSC Address Format:\n- Channels: /ch/01-32/<section>/<param>\n- Buses: /bus/01-16/<section>/<param>\n- FX: /fx/1-8/<param>\n- Main: /main/st/<section>/<param>\n\nCommon sections: mix, config, eq, dyn, gate, insert\n\nTroubleshooting:\n1. Verify address format matches OSC specification\n2. Check that mixer connection is active\n3. Ensure address exists on X32/M32 (consult OSC documentation)\n4. Try semantic tools first (channel_*, bus_*, fx_*, main_*)\n5. Address provided: ${address}`
                );
            }
        }
    );
}

/**
 * Register set_parameter tool
 * Sets parameter value by OSC address pattern
 */
function registerSetParameterTool(server: McpServer, connection: X32Connection): void {
    server.registerTool(
        'set_parameter',
        {
            title: 'Set Parameter (Low-Level)',
            description:
                'ADVANCED/LOW-LEVEL TOOL: Controls X32/M32 mixer parameters by setting specific values via raw OSC address patterns. Consider using semantic tools (channel_*, bus_*, etc.) for common operations. Use this tool for parameters not covered by semantic tools or for advanced automation.',
            inputSchema: {
                address: z
                    .string()
                    .describe(
                        'OSC address pattern for the parameter to control (e.g., "/ch/01/mix/fader" for channel 1 fader, "/main/st/mix/fader" for main stereo fader)'
                    ),
                value: z
                    .union([z.string(), z.number()])
                    .describe('Value to set - typically 0.0-1.0 for faders, 0/1 for mutes, or specific values for other parameters')
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true
            }
        },
        async ({ address, value }: SetParameterArgs): Promise<CallToolResult> => {
            if (!connection.connected) {
                return createErrorResult('Not connected to X32/M32 mixer. Use connection_connect first.');
            }

            try {
                await connection.setParameter(address, value);
                return createTextResult(`Set ${address} = ${value}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return createErrorResult(
                    `Failed to set parameter: ${errorMsg}\n\nLOW-LEVEL TOOL: This is an advanced tool for direct OSC access.\n\nWARNING: Direct parameter setting bypasses validation.\n\nPrefer semantic tools for safety:\n- Use channel_set_volume instead of /ch/XX/mix/fader\n- Use bus_set_volume instead of /bus/XX/mix/fader\n- Use fx_set_parameter instead of /fx/X/par/XX\n- Use main_set_volume instead of /main/st/mix/fader\n\nOSC Address Format:\n- Channels: /ch/01-32/<section>/<param>\n- Buses: /bus/01-16/<section>/<param>\n- FX: /fx/1-8/par/01-64\n- Main: /main/st/<section>/<param>\n\nValue Types:\n- Faders: 0.0-1.0 (linear)\n- Mutes: 0 (muted) or 1 (unmuted) - note inverted for /on parameters\n- Pan: 0.0 (left) to 0.5 (center) to 1.0 (right)\n- Colors: 0-15 integer values\n\nTroubleshooting:\n1. Verify address format matches OSC specification\n2. Check value type and range for the parameter\n3. Ensure mixer connection is active\n4. Try semantic tools first for common operations\n5. Address provided: ${address}\n6. Value provided: ${value}`
                );
            }
        }
    );
}

/**
 * Register all generic parameter tools
 */
export function registerParameterTools(server: McpServer, connection: X32Connection): void {
    registerGetParameterTool(server, connection);
    registerSetParameterTool(server, connection);
}
