/**
 * Serial Printer Service using Web Serial API
 * Supports RS232 thermal printers connected via USB-to-RS232 adapter or direct serial
 * Compatible with most ESC/POS thermal printers (Epson, Star, Generic 80mm)
 */

export class SerialPrinterService {
    private port: any | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    // Common baud rates for thermal printers: 9600, 19200, 38400, 115200
    private baudRate: number;

    constructor(baudRate: number = 9600) {
        this.baudRate = baudRate;
    }

    async connect(): Promise<boolean> {
        try {
            if (!('serial' in navigator)) {
                throw new Error('Web Serial API not supported. Use Chromium/Chrome.');
            }

            // Request serial port — browser shows a picker dialog
            this.port = await (navigator as any).serial.requestPort({
                filters: [] // Show all serial ports
            });

            // Open the port with printer settings
            await this.port!.open({
                baudRate: this.baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });

            this.writer = this.port!.writable!.getWriter();
            console.log(`[SerialPrinter] Connected at ${this.baudRate} baud`);
            return true;

        } catch (error) {
            console.error('[SerialPrinter] Connection failed:', error);
            return false;
        }
    }

    async print(data: Uint8Array): Promise<boolean> {
        if (!this.writer) {
            console.error('[SerialPrinter] Not connected');
            return false;
        }
        try {
            await this.writer.write(data);
            return true;
        } catch (error) {
            console.error('[SerialPrinter] Print failed:', error);
            return false;
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            if (this.port) {
                await this.port.close();
                this.port = null;
            }
        } catch (e) {
            console.warn('[SerialPrinter] Error disconnecting:', e);
        }
    }

    isConnected(): boolean {
        return this.port !== null;
    }

    setBaudRate(rate: number): void {
        this.baudRate = rate;
    }
}

export const serialPrinter = new SerialPrinterService(9600);
