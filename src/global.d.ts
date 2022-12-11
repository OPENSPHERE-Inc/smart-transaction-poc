export {};

declare global {
    var getAccountBalance: (account: string, mosaic_id: string) => Promise<number>;
    var transferMosaic: (from: string, to: string, mosaic_id: string, amount: number, message: string) => Promise<void>;
}
