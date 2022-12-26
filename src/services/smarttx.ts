import {
    Account, Address, AggregateTransaction, Convert, CosignatureTransaction,
    Deadline,
    InnerTransaction,
    Mosaic,
    MosaicId,
    PlainMessage,
    PublicAccount, SignedTransaction, Transaction,
    TransferTransaction,
    UInt64
} from "symbol-sdk";
import {SymbolService} from "metal-on-symbol";
import {firstValueFrom} from "rxjs";
import assert from "assert";


export interface CallData {
    method_name: string;
    arguments: any[];
}

export interface CallTransactionPayload {
    type: string;
    metal_id: string;
    hash: string;
    deadline: number;
    max_fee: string;
    signer_public_key: string;
    signature: string;
    call_data: CallData,
}

export interface SymbolLibrary {
    getAccountBalance(account: string, mosaic_id: string): Promise<number>;
    transferMosaic(from: string, to: string, mosaic_id: string, amount: number, message: string): Promise<void>;
}

export class SmartTransactionService implements SymbolLibrary {
    
    public static isCallTransactionPayload = (value: any): value is CallTransactionPayload =>
        typeof(value.type) !== "undefined" &&
        value.type === "smart" &&
        typeof(value.metal_id) === "string" &&
        typeof(value.hash) === "string" &&
        typeof(value.deadline) === "number" &&
        typeof(value.max_fee) === "string" &&
        typeof(value.signer_public_key) === "string" &&
        typeof(value.signature) === "string" &&
        typeof(value.call_data) === "object";

    private readonly transactions = new Array<InnerTransaction>();

    constructor(
        public readonly symbolService: SymbolService,
        private readonly signerAccount: Account, 
        private readonly smartTxMetalId: string,
        private readonly smartTxCallAddress: Address, 
        private readonly deadline: Deadline,
    ) { }

    public addTx(tx: InnerTransaction) {
        this.transactions.push(tx);
    }

    private async signTx(tx: Transaction) {
        const { networkGenerationHash } = await this.symbolService.getNetwork();

        const generationHashBytes = Array.from(Convert.hexToUint8(networkGenerationHash));
        const serializedBytes = Array.from(Convert.hexToUint8(tx.serialize()));
        const signature = Transaction.signRawTransaction(
            this.signerAccount.privateKey,
            Uint8Array.from(
                tx.getSigningBytes(
                    serializedBytes,
                    generationHashBytes
                )
            )
        );
        const payload = Transaction.preparePayload(Uint8Array.from(serializedBytes), signature, this.signerAccount.publicKey);
        const hash = Transaction.createTransactionHash(payload, generationHashBytes);

        return { signature, hash, payload };
    }

    private async createSignedTx(tx: Transaction) {
        const { networkGenerationHash, networkType } = await this.symbolService.getNetwork();
        const generationHashBytes = Array.from(Convert.hexToUint8(networkGenerationHash));

        const payload = tx.serialize();
        const hash = Transaction.createTransactionHash(payload, generationHashBytes);

        assert(tx.signer);
        return new SignedTransaction(payload, hash, tx.signer.publicKey, tx.type, networkType);
    }

    public async call(callData: CallData) {
        const { networkGenerationHash, epochAdjustment, networkCurrencyMosaicId, networkType } = await this.symbolService.getNetwork();

        const feeMultiplier = await this.symbolService.getFeeMultiplier(0.35);
        const smartyTx = AggregateTransaction.createComplete(
            this.deadline,
            this.transactions,
            networkType,
            []
        ).setMaxFeeForAggregate(feeMultiplier, 1);

        const { hash, signature } = await this.signTx(smartyTx);

        // Build call transaction
        const callTxPayload = JSON.stringify({
            type: "smart",
            metal_id: this.smartTxMetalId,
            hash,
            deadline: this.deadline.adjustedValue,
            max_fee: smartyTx.maxFee.toString(),
            signer_public_key: this.signerAccount.publicKey,
            signature: Convert.uint8ToHex(signature),
            call_data: callData,
        });

        const callTxs = new Array<InnerTransaction>();

        callTxs.push(TransferTransaction.create(
            Deadline.create(epochAdjustment),
            this.smartTxCallAddress,
            [ new Mosaic(networkCurrencyMosaicId, UInt64.fromUint(0)) ],
            PlainMessage.create(callTxPayload),
            networkType,
        ).toAggregate(this.signerAccount.publicAccount));

        const signedTx = this.signerAccount.sign(
            await this.symbolService.composeAggregateCompleteTx(feeMultiplier, 1, callTxs),
            networkGenerationHash
        );

        await this.symbolService.announceTxWithCosignatures(signedTx, []);
        const results = await this.symbolService.waitTxsFor(this.signerAccount, signedTx.hash, "confirmed");
        if (results.filter((result) => result.error).length) {
            throw new Error("Failed to announce call transaction.");
        }
    }

    public async fulfill(callTxPayload: CallTransactionPayload) {
        const { networkType } = await this.symbolService.getNetwork();

        const callerPubAccount = PublicAccount.createFromPublicKey(callTxPayload.signer_public_key, networkType);
        const smartyTx = AggregateTransaction.createComplete(
            this.deadline,
            this.transactions,
            networkType,
            [],
            UInt64.fromNumericString(callTxPayload.max_fee),
            callTxPayload.signature,
            callerPubAccount
        );

        const signedTx = await this.createSignedTx(smartyTx);
        const cosignature = CosignatureTransaction.signTransactionHash(this.signerAccount, signedTx.hash);
        await this.symbolService.announceTxWithCosignatures(signedTx, [ cosignature ]);
        const results = await this.symbolService.waitTxsFor(callerPubAccount, signedTx.hash, "confirmed");
        if (results.filter((result) => result.error).length) {
            throw new Error("Failed to announce call transaction.");
        }
    };

    // WASM Import functions (Symbol libs)

    public async getAccountBalance(account: string, mosaic_id: string): Promise<number> {
        const { networkType, repositoryFactory } = await this.symbolService.getNetwork();
        const accountHttp = repositoryFactory.createAccountRepository();
        const mosaicIdObj = new MosaicId(mosaic_id);

        return firstValueFrom(accountHttp.getAccountInfo(PublicAccount.createFromPublicKey(account, networkType).address))
            .then((accountInfo) =>
                accountInfo.mosaics
                    .filter((mosaic) => mosaic.id.equals(mosaicIdObj))
                    .reduce((acc, curr) => acc + Number(curr.amount.toString()), 0)
            );
    }

    public async transferMosaic(from: string, to: string, mosaic_id: string, amount: number, message: string) {
        const { networkType } = await this.symbolService.getNetwork();
        const recipientPubAccount = PublicAccount.createFromPublicKey(to, networkType);
        const senderPubAccount = PublicAccount.createFromPublicKey(from, networkType);

        const transferTx = TransferTransaction.create(
            this.deadline,
            recipientPubAccount.address,
            [ new Mosaic(new MosaicId(mosaic_id), UInt64.fromUint(amount)) ],
            PlainMessage.create(message),
            networkType
        ).toAggregate(senderPubAccount);

        this.addTx(transferTx);
    }
}