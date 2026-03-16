import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MockX32Connection } from '../services/__mocks__/mock-x32-connection.js';
import type { X32Connection } from '../services/x32-connection.js';
import {
    registerBusTools,
    registerChannelTools,
    registerConnectionTools,
    registerFxTools,
    registerMainTools,
    registerParameterTools
} from './index.js';

type Harness = {
    client: Client;
    connection: MockX32Connection;
    server: McpServer;
};

async function createHarness(): Promise<Harness> {
    const connection = new MockX32Connection();
    const typedConnection = connection as unknown as X32Connection;
    const server = new McpServer({ name: 'x32-test-server', version: '1.0.0' });

    registerConnectionTools(server, typedConnection);
    registerChannelTools(server, typedConnection);
    registerBusTools(server, typedConnection);
    registerFxTools(server, typedConnection);
    registerMainTools(server, typedConnection);
    registerParameterTools(server, typedConnection);

    const client = new Client({ name: 'x32-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return { client, connection, server };
}

async function closeHarness({ client, connection, server }: Harness): Promise<void> {
    await Promise.allSettled([client.close(), server.close()]);

    if (connection.connected) {
        await connection.disconnect();
    }
}

function getStructuredContent<T>(result: { structuredContent?: unknown }): T {
    return result.structuredContent as T;
}

async function connectMixer(client: Client): Promise<void> {
    await client.callTool({
        name: 'connection_connect',
        arguments: {
            host: '10.69.6.254',
            port: 10023
        }
    });
}

async function readmeToolNames(): Promise<string[]> {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const toolsSection = readme.split('## Available Tools')[1]?.split('## Quick Tips')[0] ?? '';

    return Array.from(toolsSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm), match => match[1]);
}

describe('MCP Tool Contracts', () => {
    let harness: Harness;

    beforeEach(async () => {
        harness = await createHarness();
    });

    afterEach(async () => {
        await closeHarness(harness);
    });

    test('tools/list exposes the registered semantic tools and schemas', async () => {
        const { tools } = await harness.client.listTools();
        const toolNames = tools.map(tool => tool.name);

        expect(toolNames).toContain('channel_get_state');
        expect(toolNames).toContain('channel_solo');
        expect(toolNames).toContain('connection_get_info');
        expect(toolNames).toContain('bus_get_state');
        expect(toolNames).toContain('fx_get_state');
        expect(toolNames).toContain('get_parameter');
    });

    test('query tools return structuredContent for agent-friendly tool chaining', async () => {
        await connectMixer(harness.client);

        harness.connection.setMockParameter('/bus/01/config/name', 'Vox Bus');
        harness.connection.setMockParameter('/bus/01/config/color', 4);
        harness.connection.setMockParameter('/bus/01/mix/fader', 0.8);
        harness.connection.setMockParameter('/bus/01/mix/on', 1);
        harness.connection.setMockParameter('/bus/01/mix/pan', 0.55);

        harness.connection.setMockParameter('/fx/1/type', 5);
        harness.connection.setMockParameter('/fx/1/par/01', 0.2);
        harness.connection.setMockParameter('/fx/1/par/02', 0.4);
        harness.connection.setMockParameter('/fx/1/par/03', 0.6);
        harness.connection.setMockParameter('/fx/1/par/04', 0.8);
        harness.connection.setMockParameter('/fx/1/par/05', 1.0);
        harness.connection.setMockParameter('/fx/1/par/06', 0.1);

        const infoResult = await harness.client.callTool({ name: 'connection_get_info', arguments: {} });
        const info = getStructuredContent<{
            consoleModel: string;
            consoleVersion: string;
            serverName: string;
            serverVersion: string;
        }>(infoResult);
        expect(info.consoleModel).toBe('X32');
        expect(info.serverName).toBe('X32 Emulator');

        const statusResult = await harness.client.callTool({ name: 'connection_get_status', arguments: {} });
        const status = getStructuredContent<{ state: string; ipAddress: string; serverName: string }>(statusResult);
        expect(status.state).toBe('active');
        expect(status.ipAddress).toBe('192.168.0.64');

        const busResult = await harness.client.callTool({ name: 'bus_get_state', arguments: { bus: 1 } });
        const busState = getStructuredContent<{
            bus: number;
            name: string | null;
            color: number | null;
            muted: boolean;
            pan: number;
        }>(busResult);
        expect(busState).toMatchObject({
            bus: 1,
            name: 'Vox Bus',
            color: 4,
            muted: false
        });
        expect(busState.pan).toBeCloseTo(0.55, 2);

        const fxResult = await harness.client.callTool({ name: 'fx_get_state', arguments: { fx: 1 } });
        const fxState = getStructuredContent<{ fx: number; type: number; parameters: Record<string, number> }>(fxResult);
        expect(fxState.fx).toBe(1);
        expect(fxState.type).toBe(5);
        expect(fxState.parameters['01']).toBeCloseTo(0.2, 2);

        const parameterResult = await harness.client.callTool({ name: 'get_parameter', arguments: { address: '/bus/01/config/name' } });
        const parameterState = getStructuredContent<{ address: string; valueType: string; value: unknown }>(parameterResult);
        expect(parameterState).toEqual({
            address: '/bus/01/config/name',
            valueType: 'string',
            value: 'Vox Bus'
        });
    });

    test('channel_solo changes solo state instead of silently succeeding', async () => {
        await connectMixer(harness.client);

        await harness.client.callTool({
            name: 'channel_solo',
            arguments: {
                channel: 1,
                solo: true
            }
        });

        expect(await harness.connection.getChannelSolo(1)).toBe(1);

        const channelStateResult = await harness.client.callTool({
            name: 'channel_get_state',
            arguments: {
                channel: 1
            }
        });
        const channelState = getStructuredContent<{ solo: boolean }>(channelStateResult);
        expect(channelState.solo).toBe(true);

        await harness.client.callTool({
            name: 'channel_solo',
            arguments: {
                channel: 1,
                solo: false
            }
        });

        expect(await harness.connection.getChannelSolo(1)).toBe(0);
    });

    test('README tool inventory matches the registered tool surface', async () => {
        const { tools } = await harness.client.listTools();
        const readmeNames = await readmeToolNames();

        expect(readmeNames.sort()).toEqual(tools.map(tool => tool.name).sort());
    });
});
