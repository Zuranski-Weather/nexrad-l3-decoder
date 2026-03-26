export class BinaryReader {
  private view: DataView;
  private _offset: number;

  constructor(buffer: ArrayBuffer, offset = 0) {
    this.view = new DataView(buffer);
    this._offset = offset;
  }

  get offset(): number {
    return this._offset;
  }

  get length(): number {
    return this.view.byteLength;
  }

  remaining(): number {
    return this.view.byteLength - this._offset;
  }

  seek(offset: number): void {
    this._offset = offset;
  }

  skip(bytes: number): void {
    this._offset += bytes;
  }

  readInt8(): number {
    const v = this.view.getInt8(this._offset);
    this._offset += 1;
    return v;
  }

  readUint8(): number {
    const v = this.view.getUint8(this._offset);
    this._offset += 1;
    return v;
  }

  readInt16(): number {
    const v = this.view.getInt16(this._offset, false);
    this._offset += 2;
    return v;
  }

  readUint16(): number {
    const v = this.view.getUint16(this._offset, false);
    this._offset += 2;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readFloat32(): number {
    const v = this.view.getFloat32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readBytes(count: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this._offset, count);
    this._offset += count;
    return bytes;
  }

  readString(count: number): string {
    const bytes = this.readBytes(count);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) break;
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }

  peekUint8(offset = 0): number {
    return this.view.getUint8(this._offset + offset);
  }

  peekUint16(offset = 0): number {
    return this.view.getUint16(this._offset + offset, false);
  }

  peekInt16(offset = 0): number {
    return this.view.getInt16(this._offset + offset, false);
  }

  slice(start: number, end: number): ArrayBuffer {
    return this.view.buffer.slice(start, end);
  }

  sliceFromCurrent(length?: number): ArrayBuffer {
    const end = length !== undefined ? this._offset + length : this.view.byteLength;
    return this.view.buffer.slice(this._offset, end);
  }
}

export function mjdToDate(mjd: number, secondsAfterMidnight: number): Date {
  const ms = (mjd - 1) * 86400000 + secondsAfterMidnight * 1000;
  return new Date(ms);
}

export function toHex(value: number, digits = 4): string {
  return '0x' + value.toString(16).toUpperCase().padStart(digits, '0');
}
