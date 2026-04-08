# RobotArmv3 Pi Service

This folder is the Raspberry Pi Node.js service used by the web app migration.

## What it does

- Opens I2C connections to joint controllers
- Exposes a WebSocket server for robot commands
- Returns simple robot status data

## Files

- `server.js` - WebSocket server and command handler
- `robotArmI2C.js` - I2C communication helper class
- `test-i2c.js` - simple I2C read test
- `package.json` - dependencies and scripts

## Commands

```bash
npm install
sudo npm run server
```

Test I2C:

```bash
sudo npm test
```

## Environment variables

- `ROBOT_ARM_PORT` (default `8080`)
- `ROBOT_ARM_I2C_BUS` (default `/dev/i2c-1`)
- `ROBOT_ARM_ADDRESSES` (default `0x22,0x23`)

Example:

```bash
export ROBOT_ARM_PORT=8080
export ROBOT_ARM_I2C_BUS=/dev/i2c-1
export ROBOT_ARM_ADDRESSES=0x22,0x23,0x24
sudo npm run server
```
