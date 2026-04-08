const i2c = require('i2c-bus');

class JointController {
  constructor(jointNumber, i2cBusPath, i2cAddress) {
    this.jointNumber = jointNumber;
    this.i2cBusPath = i2cBusPath;
    this.i2cAddress = i2cAddress;
    this.i2cBus = null;
    this.isOpen = false;

    const busMatch = i2cBusPath.match(/i2c-(\d+)/);
    this.i2cBusNumber = busMatch ? parseInt(busMatch[1], 10) : 1;
  }

  async open() {
    this.i2cBus = await i2c.openPromisified(this.i2cBusNumber);
    this.isOpen = true;
    console.log(
      `Joint ${this.jointNumber}: opened /dev/i2c-${this.i2cBusNumber} at 0x${this.i2cAddress.toString(16)}`
    );
  }

  async close() {
    if (this.i2cBus && this.isOpen) {
      await this.i2cBus.close();
      this.isOpen = false;
    }
  }

  async sendCommand(commandBytes) {
    if (!this.isOpen) {
      throw new Error(`Joint ${this.jointNumber}: bus is not open`);
    }
    const buffer = Buffer.from(commandBytes);
    await this.i2cBus.i2cWrite(this.i2cAddress, buffer.length, buffer);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async readData(byteCount) {
    if (!this.isOpen) {
      throw new Error(`Joint ${this.jointNumber}: bus is not open`);
    }
    const buffer = Buffer.alloc(byteCount);
    await this.i2cBus.i2cRead(this.i2cAddress, byteCount, buffer);
    return buffer;
  }

  async moveToAngle(angleDegrees) {
    let angleX100 = Math.round(Number(angleDegrees) * 100);
    if (angleX100 < -16000) angleX100 = -16000;
    if (angleX100 > 16000) angleX100 = 16000;

    const lsb = angleX100 & 0xff;
    const msb = (angleX100 >> 8) & 0xff;
    await this.sendCommand([0x01, lsb, msb]);
  }

  async stopMotion() {
    await this.sendCommand([0x02]);
  }

  async readStatus() {
    const data = await this.readData(8);

    const isMoving = data[0] === 1;
    const stallDetected = data[1] === 1;
    const stepPosition = data.readInt32LE(2);
    const angleX100 = data.readInt16LE(6);
    const angleDegrees = angleX100 / 100;

    return {
      isMoving,
      stallDetected,
      stepPosition,
      angleDegrees,
    };
  }
}

module.exports = { JointController };
