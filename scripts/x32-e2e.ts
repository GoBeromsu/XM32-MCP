#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { X32Connection } from '../src/services/x32-connection.js';

const HOST = '127.0.0.1';
const PORT = 10023;
const STARTUP_TIMEOUT_MS = 10_000;
const LOG_TAIL_LIMIT = 40;
const EXPECTED_TOOL_NAMES = [
    'connection_connect',
    'connection_disconnect',
    'connection_get_info',
    'connection_get_status',
    'channel_set_volume',
    'channel_set_gain',
    'channel_mute',
    'channel_solo',
    'channel_get_state',
    'channel_set_eq_band',
    'channel_set_name',
    'channel_set_color',
    'channel_set_pan',
    'bus_set_volume',
    'bus_mute',
    'bus_set_send',
    'bus_get_state',
    'fx_set_parameter',
    'fx_get_state',
    'fx_bypass',
    'main_set_volume',
    'main_mute',
    'monitor_set_level',
    'get_parameter',
    'set_parameter'
].sort();

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emulatorPath = path.join(repoRoot, 'X32_emulator');
const tsxCliPath = require.resolve('tsx/cli');

function log(message: string): void {
    console.log(`[x32:e2e] ${message}`);
}

function appendLog(logs: string[], chunk: Buffer | string): void {
    const lines = String(chunk)
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean);

    logs.push(...lines);
    if (logs.length > LOG_TAIL_LIMIT) {
        logs.splice(0, logs.length - LOG_TAIL_LIMIT);
    }
}

function formatLogTail(name: string, logs: string[]): string {
    if (logs.length === 0) {
        return `${name}: no output captured`;
    }

    return `${name} (last ${logs.length} lines):\n${logs.join('\n')}`;
}

async function assertSupportedEnvironment(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        throw new Error(`The bundled X32 emulator is only supported on macOS arm64. Current platform: ${process.platform}/${process.arch}`);
    }

    try {
        await access(emulatorPath, constants.X_OK);
    } catch {
        throw new Error(
            `X32 emulator is missing or not executable at ${emulatorPath}. Verify the bundled binary is present and has execute permission.`
        );
    }
}

async function assertPortAvailable(host: string, port: number): Promise<void> {
    const socket = dgram.createSocket('udp4');

    try {
        await new Promise<void>((resolve, reject) => {
            socket.once('error', error => {
                reject(error);
            });

            socket.bind(port, host, () => {
                resolve();
            });
        });
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EADDRINUSE') {
            throw new Error(
                `UDP ${host}:${port} is already in use. Stop any existing X32 emulator or mixer proxy before running x32:test.`
            );
        }

        throw new Error(`Failed to reserve UDP ${host}:${port}: ${err.message}`);
    } finally {
        socket.close();
    }
}

async function waitForEmulatorReady(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`X32 emulator exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode})`);
        }

        const connection = new X32Connection();

        try {
            await connection.connect({ host: HOST, port: PORT });
            await connection.getInfo();
            await connection.disconnect();
            return;
        } catch (error) {
            lastError = error;

            if (connection.connected) {
                await connection.disconnect().catch(() => undefined);
            }

            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Timed out waiting for X32 emulator readiness on ${HOST}:${PORT}. Last error: ${lastMessage}`);
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams | undefined, name: string): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    child.kill('SIGTERM');

    const exited = await Promise.race([
        once(child, 'exit').then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000))
    ]);

    if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit').catch(() => undefined);
    }

    log(`Stopped ${name}`);
}

function extractText(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }): string {
    return (
        result.content
            ?.filter(item => item.type === 'text')
            .map(item => item.text ?? '')
            .join('\n') ?? ''
    );
}

async function callToolText(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await client.callTool({
        name,
        arguments: args
    });

    const text = extractText(result);
    assert(!result.isError, `${name} returned an MCP error:\n${text}`);
    return text;
}

export async function runX32E2E(): Promise<void> {
    let emulator: ChildProcessWithoutNullStreams | undefined;
    let client: Client | undefined;
    let transport: StdioClientTransport | undefined;
    let cleanedUp = false;

    const emulatorLogs: string[] = [];
    const serverLogs: string[] = [];

    const cleanup = async (): Promise<void> => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;

        if (client) {
            await client.close().catch(() => undefined);
            client = undefined;
        } else if (transport) {
            await transport.close().catch(() => undefined);
        }

        transport = undefined;
        await stopChildProcess(emulator, 'X32 emulator');
        emulator = undefined;
    };
    const handleSignal = (signal: NodeJS.Signals): void => {
        log(`Received ${signal}, cleaning up`);
        void cleanup().finally(() => {
            process.exit(1);
        });
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    try {
        await assertSupportedEnvironment();
        await assertPortAvailable(HOST, PORT);

        log(`Starting X32 emulator on ${HOST}:${PORT}`);
        emulator = spawn(emulatorPath, ['-i', HOST, '-v', '0'], {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        emulator.stdout.on('data', chunk => {
            appendLog(emulatorLogs, chunk);
        });
        emulator.stderr.on('data', chunk => {
            appendLog(emulatorLogs, chunk);
        });

        await waitForEmulatorReady(emulator, STARTUP_TIMEOUT_MS);
        log('X32 emulator is ready');

        transport = new StdioClientTransport({
            command: process.execPath,
            args: [tsxCliPath, 'src/index.ts'],
            cwd: repoRoot,
            stderr: 'pipe'
        });

        const stderrStream = transport.stderr;
        if (stderrStream) {
            stderrStream.on('data', chunk => {
                appendLog(serverLogs, chunk);
            });
        }

        client = new Client({
            name: 'x32-e2e-runner',
            version: '1.0.0'
        });

        log('Connecting MCP client to server over stdio');
        await client.connect(transport);

        const listedTools = await client.listTools();
        const toolNames = listedTools.tools.map(tool => tool.name).sort();
        assert.deepStrictEqual(toolNames, EXPECTED_TOOL_NAMES, `Unexpected tool registration set:\n${toolNames.join('\n')}`);
        log(`Verified ${toolNames.length} registered MCP tools`);

        const connectText = await callToolText(client, 'connection_connect', { host: HOST, port: PORT });
        assert.match(connectText, /Successfully connected to X32\/M32/);

        const infoText = await callToolText(client, 'connection_get_info');
        assert.match(infoText, /Console Model: X32/);
        assert.match(infoText, /X32 Emulator/);

        const setNameText = await callToolText(client, 'channel_set_name', { channel: 1, name: 'Lead Vox' });
        assert.match(setNameText, /Set channel 1 name to "Lead Vox"/);
        const channelNameText = await callToolText(client, 'get_parameter', { address: '/ch/01/config/name' });
        assert.match(channelNameText, /\/ch\/01\/config\/name = "Lead Vox"/);

        const busText = await callToolText(client, 'bus_set_volume', { bus: 1, value: 0.5, unit: 'linear' });
        assert.match(busText, /Set bus 1 to/);
        const busValueText = await callToolText(client, 'get_parameter', { address: '/bus/01/mix/fader' });
        assert.match(busValueText, /\/bus\/01\/mix\/fader = 0\.5/);

        const fxText = await callToolText(client, 'fx_set_parameter', { fx: 1, parameter: 1, value: 0.5 });
        assert.match(fxText, /Set FX 1 parameter 01 to 0\.500/);
        const fxValueText = await callToolText(client, 'get_parameter', { address: '/fx/1/par/01' });
        assert.match(fxValueText, /\/fx\/1\/par\/01 = 0\.5/);

        // Verify case-insensitive unit: "dB" should be accepted (lowercased to "db")
        const chVolDbText = await callToolText(client, 'channel_set_volume', { channel: 1, value: -6, unit: 'dB' });
        assert.match(chVolDbText, /Set channel 1 to/);

        // Verify renamed mute parameter (was "muted", now "mute")
        const muteText = await callToolText(client, 'channel_mute', { channel: 1, mute: true });
        assert.match(muteText, /Channel 1 muted/);
        const unmuteText = await callToolText(client, 'channel_mute', { channel: 1, mute: false });
        assert.match(unmuteText, /Channel 1 unmuted/);

        // Verify gain accepts dB unit
        const gainDbText = await callToolText(client, 'channel_set_gain', { channel: 1, gain: 25, unit: 'db' });
        assert.match(gainDbText, /Set channel 1 preamp gain to 25\.0 dB/);

        // Verify EQ band accepts individual params (frequency, gain, q)
        const eqText = await callToolText(client, 'channel_set_eq_band', { channel: 1, band: 1, frequency: 0.5, gain: 0.7 });
        assert.match(eqText, /Set channel 1 EQ band 1/);
        assert.match(eqText, /frequency=0\.5/);
        assert.match(eqText, /gain=0\.7/);

        const disconnectText = await callToolText(client, 'connection_disconnect');
        assert.match(disconnectText, /Successfully disconnected from X32\/M32 mixer/);

        log('E2E checks passed');
    } catch (error) {
        console.error('[x32:e2e] Test failed');
        console.error(formatLogTail('emulator logs', emulatorLogs));
        console.error(formatLogTail('server logs', serverLogs));
        throw error;
    } finally {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        await cleanup();
    }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
    runX32E2E().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
