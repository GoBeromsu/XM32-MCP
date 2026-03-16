// @ts-expect-error: OSC module lacks type definitions
import osc from 'osc';
import { EventEmitter } from 'events';
import { X32ConnectionConfig, X32InfoResponse, X32StatusResponse, OscMessage, UDPPort } from '../types/index.js';

/**
 * X32 Connection Manager
 * Manages UDP connection to X32/M32 mixer
 */
export class X32Connection extends EventEmitter {
    private udpPort: UDPPort | null = null;
    private config: X32ConnectionConfig | null = null;
    private isConnected: boolean = false;
    private messageQueue: Map<string, { resolve: (msg: OscMessage) => void; timeout: NodeJS.Timeout }> = new Map();
    private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds

    constructor() {
        super();
    }

    /**
     * Connect to X32/M32 mixer
     */
    async connect(config: X32ConnectionConfig): Promise<void> {
        if (this.isConnected) {
            throw new Error('Already connected to X32/M32');
        }

        this.config = config;

        return new Promise((resolve, reject) => {
            this.udpPort = new osc.UDPPort({
                localAddress: '0.0.0.0',
                localPort: 0, // Let OS assign a random port
                remoteAddress: config.host,
                remotePort: config.port,
                metadata: true
            });

            this.udpPort!.on('ready', () => {
                this.isConnected = true;
                this.emit('connected');
                resolve();
            });

            this.udpPort!.on('error', (err: Error) => {
                this.emit('error', err);
                if (!this.isConnected) {
                    reject(err);
                }
            });

            this.udpPort!.on('message', (oscMsg: unknown) => {
                this.handleIncomingMessage(oscMsg as OscMessage);
            });

            try {
                if (this.udpPort) {
                    this.udpPort.open();
                } else {
                    reject(new Error('Failed to create UDP port'));
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnect from X32/M32 mixer
     */
    async disconnect(): Promise<void> {
        if (!this.isConnected || !this.udpPort) {
            return;
        }

        return new Promise(resolve => {
            if (this.udpPort) {
                this.udpPort.close();
                this.isConnected = false;
                this.udpPort = null;
                this.emit('disconnected');
                resolve();
            } else {
                resolve();
            }
        });
    }

    /**
     * Send OSC message and wait for response
     */
    async sendMessage(address: string, args: unknown[] = [], waitForReply: boolean = true): Promise<OscMessage | null> {
        if (!this.isConnected || !this.udpPort) {
            throw new Error('Not connected to X32/M32');
        }

        return new Promise((resolve, reject) => {
            if (!this.udpPort) {
                reject(new Error('UDP port not initialized'));
                return;
            }

            if (waitForReply) {
                const timeout = setTimeout(() => {
                    this.messageQueue.delete(address);
                    reject(new Error(`Timeout waiting for response from ${address}`));
                }, this.DEFAULT_TIMEOUT);

                this.messageQueue.set(address, {
                    resolve: (msg: OscMessage) => {
                        clearTimeout(timeout);
                        this.messageQueue.delete(address);
                        resolve(msg);
                    },
                    timeout
                });
            }

            try {
                this.udpPort.send({
                    address,
                    args: args.map(arg => {
                        if (typeof arg === 'number') {
                            if (Number.isInteger(arg)) {
                                return { type: 'i', value: arg };
                            }
                            return { type: 'f', value: arg };
                        } else if (typeof arg === 'string') {
                            return { type: 's', value: arg };
                        } else if (Buffer.isBuffer(arg)) {
                            return { type: 'b', value: arg };
                        }
                        return { type: 's', value: String(arg) };
                    })
                });

                if (!waitForReply) {
                    resolve(null);
                }
            } catch (err) {
                if (waitForReply) {
                    const queueItem = this.messageQueue.get(address);
                    if (queueItem) {
                        clearTimeout(queueItem.timeout);
                        this.messageQueue.delete(address);
                    }
                }
                reject(err);
            }
        });
    }

    /**
     * Get X32/M32 info
     */
    async getInfo(): Promise<X32InfoResponse> {
        const response = await this.sendMessage('/info');
        if (!response) {
            throw new Error('No response from /info');
        }

        // Parse response: /info,ssss~V2.05~osc-server~X32~2.12
        const args = response.args;
        if (args.length < 4) {
            throw new Error('Invalid /info response format');
        }

        return {
            serverVersion: String(args[0].value),
            serverName: String(args[1].value),
            consoleModel: String(args[2].value),
            consoleVersion: String(args[3].value)
        };
    }

    /**
     * Get X32/M32 status
     */
    async getStatus(): Promise<X32StatusResponse> {
        const response = await this.sendMessage('/status');
        if (!response) {
            throw new Error('No response from /status');
        }

        // Parse response: /status,sss~active~192.168.0.64~osc-server
        const args = response.args;
        if (args.length < 3) {
            throw new Error('Invalid /status response format');
        }

        return {
            state: String(args[0].value),
            ipAddress: String(args[1].value),
            serverName: String(args[2].value)
        };
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this.isConnected;
    }

    /**
     * Get connection config
     */
    getConfig(): X32ConnectionConfig | null {
        return this.config;
    }

    /**
     * Get parameter value from X32/M32
     * @param address OSC address pattern (e.g., '/ch/01/mix/fader')
     * @returns Parameter value
     */
    async getParameter<T = unknown>(address: string): Promise<T> {
        const response = await this.sendMessage(address);
        if (!response || !response.args || response.args.length === 0) {
            throw new Error(`No value returned from ${address}`);
        }
        return response.args[0].value as T;
    }

    /**
     * Set parameter value on X32/M32
     * @param address OSC address pattern
     * @param value Value to set (string, number, or buffer)
     */
    async setParameter(address: string, value: unknown): Promise<void> {
        await this.sendMessage(address, [value], false);
    }

    /**
     * Get channel parameter
     * @param channel Channel number (1-32)
     * @param param Parameter path (e.g., 'config/name', 'mix/fader')
     * @returns Parameter value
     */
    async getChannelParameter<T = unknown>(channel: number, param: string): Promise<T> {
        if (channel < 1 || channel > 32) {
            throw new Error('Channel must be between 1 and 32');
        }
        const ch = channel.toString().padStart(2, '0');
        return this.getParameter<T>(`/ch/${ch}/${param}`);
    }

    /**
     * Set channel parameter
     * @param channel Channel number (1-32)
     * @param param Parameter path (e.g., 'config/name', 'mix/fader')
     * @param value Value to set
     */
    async setChannelParameter(channel: number, param: string, value: unknown): Promise<void> {
        if (channel < 1 || channel > 32) {
            throw new Error('Channel must be between 1 and 32');
        }
        const ch = channel.toString().padStart(2, '0');
        await this.setParameter(`/ch/${ch}/${param}`, value);
    }

    /**
     * Get channel solo state from the X32 solo switch status path.
     * @param channel Channel number (1-32)
     * @returns Solo state as 0 or 1
     */
    async getChannelSolo(channel: number): Promise<number> {
        if (channel < 1 || channel > 32) {
            throw new Error('Channel must be between 1 and 32');
        }
        const ch = channel.toString().padStart(2, '0');
        return this.getParameter<number>(`/-stat/solosw/${ch}`);
    }

    /**
     * Set channel solo state using the X32 solo switch status path.
     * @param channel Channel number (1-32)
     * @param solo True to solo, false to unsolo
     */
    async setChannelSolo(channel: number, solo: boolean): Promise<void> {
        if (channel < 1 || channel > 32) {
            throw new Error('Channel must be between 1 and 32');
        }
        const ch = channel.toString().padStart(2, '0');
        await this.setParameter(`/-stat/solosw/${ch}`, solo ? 1 : 0);
    }

    /**
     * Get bus parameter
     * @param bus Bus number (1-16)
     * @param param Parameter path (e.g., 'mix/fader', 'mix/on')
     * @returns Parameter value
     */
    async getBusParameter<T = unknown>(bus: number, param: string): Promise<T> {
        if (bus < 1 || bus > 16) {
            throw new Error('Bus must be between 1 and 16');
        }
        const busNum = bus.toString().padStart(2, '0');
        return this.getParameter<T>(`/bus/${busNum}/${param}`);
    }

    /**
     * Set bus parameter
     * @param bus Bus number (1-16)
     * @param param Parameter path (e.g., 'mix/fader', 'mix/on')
     * @param value Value to set
     */
    async setBusParameter(bus: number, param: string, value: unknown): Promise<void> {
        if (bus < 1 || bus > 16) {
            throw new Error('Bus must be between 1 and 16');
        }
        const busNum = bus.toString().padStart(2, '0');
        await this.setParameter(`/bus/${busNum}/${param}`, value);
    }

    /**
     * Handle incoming OSC message
     */
    private handleIncomingMessage(oscMsg: OscMessage): void {
        const message: OscMessage = {
            address: oscMsg.address,
            args: oscMsg.args || []
        };

        this.emit('message', message);

        // Check if there's a pending request for this address
        const queueItem = this.messageQueue.get(message.address);
        if (queueItem) {
            queueItem.resolve(message);
        }
    }
}
