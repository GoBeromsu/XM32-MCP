import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function createErrorResult(text: string): CallToolResult {
    return {
        content: [{ type: 'text', text }],
        isError: true
    };
}

export function createTextResult(text: string): CallToolResult {
    return {
        content: [{ type: 'text', text }]
    };
}

export function createStructuredTextResult<T extends Record<string, JsonValue>>(text: string, structuredContent: T): CallToolResult {
    return {
        content: [{ type: 'text', text }],
        structuredContent
    };
}

export function normalizeOscValue(value: unknown): JsonValue {
    if (value === null) {
        return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Buffer.isBuffer(value)) {
        return Array.from(value.values());
    }

    if (Array.isArray(value)) {
        return value.map(item => normalizeOscValue(item));
    }

    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeOscValue(item)]));
    }

    return String(value);
}
