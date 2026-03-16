#!/usr/bin/env node
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { X32Connection } from './services/x32-connection.js';
import {
    registerConnectionTools,
    registerChannelTools,
    registerBusTools,
    registerFxTools,
    registerMainTools,
    registerParameterTools
} from './tools/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * X32 MCP Server
 * Model Context Protocol server for X32/M32 mixer control
 */
async function main() {
    // Create X32 connection instance
    const connection = new X32Connection();

    // Create MCP server using McpServer class
    const server = new McpServer(
        {
            name: 'x-m32-mcp-server',
            version
        },
        {
            capabilities: {
                tools: {
                    listChanged: true
                }
            }
        }
    );

    // Register all domain tools
    registerConnectionTools(server, connection);
    registerChannelTools(server, connection);
    registerBusTools(server, connection);
    registerFxTools(server, connection);
    registerMainTools(server, connection);
    registerParameterTools(server, connection);

    // Setup connection event handlers
    connection.on('connected', () => {
        console.error('X32 Connected');
    });

    connection.on('disconnected', () => {
        console.error('X32 Disconnected');
    });

    connection.on('error', error => {
        console.error('X32 Error:', error);
    });

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    console.error('X32 MCP Server running on stdio');
    console.error('');
    console.error('Connection tools:');
    console.error('  - connection_connect: Connect to X32/M32 mixer');
    console.error('  - connection_disconnect: Disconnect from mixer');
    console.error('  - connection_get_info: Get mixer information');
    console.error('  - connection_get_status: Get connection status');
    console.error('');
    console.error('Channel tools:');
    console.error('  - channel_set_volume: Set channel volume (linear or dB)');
    console.error('  - channel_set_gain: Set preamp gain');
    console.error('  - channel_mute: Mute/unmute channel');
    console.error('  - channel_solo: Solo/unsolo channel');
    console.error('  - channel_set_name: Set channel name');
    console.error('  - channel_set_color: Set channel color');
    console.error('  - channel_set_pan: Set stereo position');
    console.error('  - channel_set_eq_band: Configure EQ');
    console.error('');
    console.error('Bus tools:');
    console.error('  - bus_set_volume: Set bus volume (linear or dB)');
    console.error('  - bus_mute: Mute/unmute bus');
    console.error('  - bus_set_send: Set channel send level to bus');
    console.error('  - bus_get_state: Get complete bus state');
    console.error('');
    console.error('FX tools:');
    console.error('  - fx_set_parameter: Set effects parameter');
    console.error('  - fx_get_state: Get effects state');
    console.error('  - fx_bypass: Bypass/enable effect');
    console.error('');
    console.error('Main/Monitor tools:');
    console.error('  - main_set_volume: Set main stereo output volume (linear or dB)');
    console.error('  - main_mute: Mute/unmute main output');
    console.error('  - monitor_set_level: Set monitor output level (linear or dB)');
    console.error('');
    console.error('Low-level tools:');
    console.error('  - get_parameter: Get any parameter by OSC address');
    console.error('  - set_parameter: Set any parameter by OSC address');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.error('\nShutting down...');
        if (connection.connected) {
            await connection.disconnect();
        }
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.error('\nShutting down...');
        if (connection.connected) {
            await connection.disconnect();
        }
        process.exit(0);
    });
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
