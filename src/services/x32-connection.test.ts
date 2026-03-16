import { jest } from '@jest/globals';
import { MockX32Connection } from './__mocks__/mock-x32-connection.js';
import { dbToFader } from '../utils/db-converter.js';

describe('X32Connection Tests', () => {
    let connection: MockX32Connection;

    beforeEach(() => {
        connection = new MockX32Connection();
    });

    afterEach(async () => {
        if (connection.connected) {
            await connection.disconnect();
        }
        connection.reset();
    });

    describe('Connection Management', () => {
        test('should connect successfully', async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
            expect(connection.connected).toBe(true);
        });

        test('should throw error when already connected', async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
            await expect(connection.connect({ host: '10.69.6.254', port: 10023 })).rejects.toThrow('Already connected to X32/M32');
        });

        test('should disconnect successfully', async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
            await connection.disconnect();
            expect(connection.connected).toBe(false);
        });

        test('should handle disconnect when not connected', async () => {
            await expect(connection.disconnect()).resolves.not.toThrow();
        });

        test('should emit connected event', async () => {
            const connectedSpy = jest.fn();
            connection.on('connected', connectedSpy);

            await connection.connect({ host: '10.69.6.254', port: 10023 });

            expect(connectedSpy).toHaveBeenCalledTimes(1);
        });

        test('should emit disconnected event', async () => {
            const disconnectedSpy = jest.fn();
            connection.on('disconnected', disconnectedSpy);

            await connection.connect({ host: '10.69.6.254', port: 10023 });
            await connection.disconnect();

            expect(disconnectedSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Mixer Info', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should get mixer info', async () => {
            const info = await connection.getInfo();
            expect(info.consoleModel).toBe('X32');
            expect(info.serverName).toBe('X32 Emulator');
            expect(info.serverVersion).toBe('V2.05');
            expect(info.consoleVersion).toBe('2.12');
        });

        test('should get mixer status', async () => {
            const status = await connection.getStatus();
            expect(status.state).toBe('active');
            expect(status.ipAddress).toBe('192.168.0.64');
            expect(status.serverName).toBe('osc-server');
        });

        test('should throw error when getting info while disconnected', async () => {
            await connection.disconnect();
            await expect(connection.getInfo()).rejects.toThrow('Not connected to X32/M32');
        });
    });

    describe('Channel Parameters', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should set and get channel fader', async () => {
            const unityFader = dbToFader(0);
            await connection.setChannelParameter(1, 'mix/fader', unityFader);

            const result = await connection.getChannelParameter(1, 'mix/fader');
            expect(Number(result)).toBeCloseTo(0.75, 2);
        });

        test('should set and get channel name', async () => {
            await connection.setChannelParameter(1, 'config/name', 'Test Ch');
            const name = await connection.getChannelParameter(1, 'config/name');
            expect(name).toBe('Test Ch');
        });

        test('should set and get channel color', async () => {
            await connection.setChannelParameter(1, 'config/color', 1); // Red
            const color = await connection.getChannelParameter(1, 'config/color');
            expect(Number(color)).toBe(1);
        });

        test('should validate channel range', async () => {
            await expect(connection.getChannelParameter(0, 'mix/fader')).rejects.toThrow('Channel must be between 1 and 32');

            await expect(connection.getChannelParameter(33, 'mix/fader')).rejects.toThrow('Channel must be between 1 and 32');
        });
    });

    describe('Channel Mute and Solo', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should mute and unmute channel', async () => {
            // Test mute (X32 inverted logic: 0 = muted)
            await connection.setChannelParameter(1, 'mix/on', 0);
            let onState = await connection.getChannelParameter(1, 'mix/on');
            expect(Number(onState)).toBe(0);

            // Test unmute
            await connection.setChannelParameter(1, 'mix/on', 1);
            onState = await connection.getChannelParameter(1, 'mix/on');
            expect(Number(onState)).toBe(1);
        });

        test('should solo and unsolo channel', async () => {
            // Test solo
            await connection.setChannelParameter(1, 'solo', 1);
            let soloState = await connection.getChannelParameter(1, 'solo');
            expect(Number(soloState)).toBe(1);

            // Test unsolo
            await connection.setChannelParameter(1, 'solo', 0);
            soloState = await connection.getChannelParameter(1, 'solo');
            expect(Number(soloState)).toBe(0);
        });
    });

    describe('Channel Pan Control', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should set pan to center', async () => {
            await connection.setChannelParameter(1, 'mix/pan', 0.5);
            const pan = await connection.getChannelParameter(1, 'mix/pan');
            expect(Number(pan)).toBeCloseTo(0.5, 2);
        });

        test('should set pan to full left', async () => {
            await connection.setChannelParameter(1, 'mix/pan', 0);
            const pan = await connection.getChannelParameter(1, 'mix/pan');
            expect(Number(pan)).toBe(0);
        });

        test('should set pan to full right', async () => {
            await connection.setChannelParameter(1, 'mix/pan', 1);
            const pan = await connection.getChannelParameter(1, 'mix/pan');
            expect(Number(pan)).toBe(1);
        });
    });

    describe('Bus Parameters', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should set and get bus fader', async () => {
            await connection.setBusParameter(1, 'mix/fader', 0.5);
            const fader = await connection.getBusParameter(1, 'mix/fader');
            expect(Number(fader)).toBe(0.5);
        });

        test('should validate bus range', async () => {
            await expect(connection.getBusParameter(0, 'mix/fader')).rejects.toThrow('Bus must be between 1 and 16');

            await expect(connection.getBusParameter(17, 'mix/fader')).rejects.toThrow('Bus must be between 1 and 16');
        });
    });

    describe('Generic Parameters', () => {
        beforeEach(async () => {
            await connection.connect({ host: '10.69.6.254', port: 10023 });
        });

        test('should set and get generic parameter', async () => {
            await connection.setParameter('/main/st/mix/fader', 0.8);
            const fader = await connection.getParameter('/main/st/mix/fader');
            expect(Number(fader)).toBe(0.8);
        });

        test('should throw error when parameter not found', async () => {
            await expect(connection.getParameter('/invalid/parameter')).rejects.toThrow('No value returned from /invalid/parameter');
        });

        test('should handle sending without waiting for reply', async () => {
            const result = await connection.sendMessage('/ch/01/mix/fader', [0.5], false);
            expect(result).toBeNull();
        });
    });

    describe('Error Handling', () => {
        test('should throw error when sending message while disconnected', async () => {
            await expect(connection.sendMessage('/info')).rejects.toThrow('Not connected to X32/M32');
        });

        test('should throw error when getting parameter while disconnected', async () => {
            await expect(connection.getParameter('/ch/01/mix/fader')).rejects.toThrow('Not connected to X32/M32');
        });

        test('should throw error when setting parameter while disconnected', async () => {
            await expect(connection.setParameter('/ch/01/mix/fader', 0.5)).rejects.toThrow('Not connected to X32/M32');
        });
    });
});
