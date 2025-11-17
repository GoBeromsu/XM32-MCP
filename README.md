# X32/M32 MCP Server

MCP server for controlling Behringer X32/M32 digital mixing consoles via OSC protocol.

## When to Use This

- **Remote Mixing**: Control your X32/M32 from anywhere on the network
- **Automated Setup**: Quickly configure channels for rehearsals or shows
- **Batch Operations**: Apply settings to multiple channels at once
- **Documentation**: Query and document current mixer settings
- **Troubleshooting**: Check mixer state without physical access
- **Live Adjustments**: Make quick changes during performances via AI assistant

## Features

- 32 input channels with volume, gain, mute, solo, EQ, pan control
- 16 mix buses for aux sends and monitor mixes
- 8 FX racks with parameter control
- Main/monitor output control
- Direct OSC parameter access for advanced users

## Installation

```bash
git clone https://github.com/GoBeromsu/X32-MCP.git
cd X32-MCP
npm install && npm run build
```

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
    "mcpServers": {
        "x32": {
            "command": "npx",
            "args": ["x-m32-mcp-server"]
        }
    }
}
```

### Connect to Mixer

```
connection_connect with host="192.168.1.100" and port=10023
```

## Available Tools (21 total)

| Tool | Parameters |
|------|------------|
| **Connection (4)** |  |
| `connection_connect` | `host`, `port` |
| `connection_disconnect` | - |
| `connection_get_info` | - |
| `connection_get_status` | - |
| **Channel (8)** |  |
| `channel_set_volume` | `channel`, `value`, `unit` |
| `channel_set_gain` | `channel`, `gain` |
| `channel_mute` | `channel`, `muted` |
| `channel_solo` | `channel`, `solo` |
| `channel_set_name` | `channel`, `name` |
| `channel_set_color` | `channel`, `color` |
| `channel_set_pan` | `channel`, `pan` |
| `channel_set_eq_band` | `channel`, `band`, `parameter`, `value` |
| **Bus (4)** |  |
| `bus_set_volume` | `bus`, `value`, `unit` |
| `bus_mute` | `bus`, `muted` |
| `bus_set_send` | `channel`, `bus`, `value`, `unit` |
| `bus_get_state` | `bus` |
| **FX (3)** |  |
| `fx_set_parameter` | `fx`, `parameter`, `value` |
| `fx_get_state` | `fx` |
| `fx_bypass` | `fx`, `bypass` |
| **Main/Monitor (3)** |  |
| `main_set_volume` | `value`, `unit` |
| `main_mute` | `muted` |
| `monitor_set_level` | `value`, `unit` |
| **Low-Level (2)** |  |
| `get_parameter` | `address` |
| `set_parameter` | `address`, `value` |

## Quick Tips

- **Unity Gain**: 0 dB = 0.75 linear (neutral, no boost/cut)
- **Safe Start**: Begin with channel at -20 dB and muted
- **Channel Colors**: Use colors to organize (red=vocals, blue=drums, etc.)
- **Bus Usage**: 1-4 monitors, 5-6 FX sends, 7-8 recording, 9-16 IEM/matrix
- **Network**: X32 uses port 10023, connect to same network as computer

## Parameter Reference

### Common Parameters
- `channel`: 1-32
- `bus`: 1-16
- `fx`: 1-8
- `unit`: "linear" (0.0-1.0) or "db" (-90 to +10)
- `muted`/`solo`/`bypass`: true/false
- `pan`: -100 to +100, "L50"/"C"/"R50", or 0.0-1.0
- `color`: "red", "green", "blue", etc. or 0-15
- `band`: 1-4 (EQ bands)
- `parameter`: "f" (frequency), "g" (gain), "q" (Q factor)

### Value Ranges
- Volume linear: 0.0-1.0 (unity = 0.75)
- Volume dB: -90 to +10 (unity = 0 dB)
- Gain: 0.0-1.0
- FX parameter: 0.0-1.0
- Channel name: max 12 characters


## License

MIT

## Support

https://github.com/GoBeromsu/X32-MCP
