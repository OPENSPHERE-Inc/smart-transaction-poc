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


export namespace SmartTransactionService {

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

    export const isCallTransactionPayload = (value: any): value is CallTransactionPayload =>
        typeof(value.type) !== "undefined" &&
        value.type === "smart" &&
        typeof(value.metal_id) === "string" &&
        typeof(value.hash) === "string" &&
        typeof(value.deadline) === "number" &&
        typeof(value.max_fee) === "string" &&
        typeof(value.signer_public_key) === "string" &&
        typeof(value.signature) === "string" &&
        typeof(value.call_data) === "object";

    let transactions = new Array<InnerTransaction>();
    let signerAccount: Account;
    let smartTxMetalId: string;
    let smartTxCallAddress: Address;
    let deadline: Deadline;

    export const init = async (account: Account, metalId: string, callAddress: Address, calledDeadline?: number) => {
        transactions = [];
        signerAccount = account;
        smartTxMetalId = metalId;
        smartTxCallAddress = callAddress;

        const { epochAdjustment } = await SymbolService.getNetwork();
        deadline = calledDeadline
            ? Deadline.createFromAdjustedValue(calledDeadline)
            : Deadline.create(epochAdjustment, 5);
    };

    export const addTx = (tx: InnerTransaction) => {
        transactions.push(tx);
    };

    const signTx = async (tx: Transaction) => {
        const { networkGenerationHash } = await SymbolService.getNetwork();

        const generationHashBytes = Array.from(Convert.hexToUint8(networkGenerationHash));
        const serializedBytes = Array.from(Convert.hexToUint8(tx.serialize()));
        const signature = Transaction.signRawTransaction(
            signerAccount.privateKey,
            Uint8Array.from(
                tx.getSigningBytes(
                    serializedBytes,
                    generationHashBytes
                )
            )
        );
        const payload = Transaction.preparePayload(Uint8Array.from(serializedBytes), signature, signerAccount.publicKey);
        const hash = Transaction.createTransactionHash(payload, generationHashBytes);

        return { signature, hash, payload };
    };

    const createSignedTx = async (tx: Transaction) => {
        const { networkGenerationHash, networkType } = await SymbolService.getNetwork();
        const generationHashBytes = Array.from(Convert.hexToUint8(networkGenerationHash));

        const payload = tx.serialize();
        const hash = Transaction.createTransactionHash(payload, generationHashBytes);

        assert(tx.signer);
        return new SignedTransaction(payload, hash, tx.signer.publicKey, tx.type, networkType);
    };

    export const call = async (callData: CallData) => {
        const { networkGenerationHash, epochAdjustment, networkCurrencyMosaicId, networkType } = await SymbolService.getNetwork();

        const feeMultiplier = await SymbolService.getFeeMultiplier(0.35);
        const smartyTx = AggregateTransaction.createComplete(
            deadline,
            transactions,
            networkType,
            []
        ).setMaxFeeForAggregate(feeMultiplier, 1);

        const { hash, signature } = await signTx(smartyTx);

        // Build call transaction
        const callTxPayload = JSON.stringify({
            type: "smart",
            metal_id: smartTxMetalId,
            hash,
            deadline: deadline.adjustedValue,
            max_fee: smartyTx.maxFee.toString(),
            signer_public_key: signerAccount.publicKey,
            signature: Convert.uint8ToHex(signature),
            call_data: callData,
        });

        const callTxs = new Array<InnerTransaction>();

        callTxs.push(TransferTransaction.create(
            Deadline.create(epochAdjustment),
            smartTxCallAddress,
            [ new Mosaic(networkCurrencyMosaicId, UInt64.fromUint(0)) ],
            PlainMessage.create(callTxPayload),
            networkType,
        ).toAggregate(signerAccount.publicAccount));

        const signedTx = signerAccount.sign(
            await SymbolService.composeAggregateCompleteTx(feeMultiplier, 1, callTxs),
            networkGenerationHash
        );

        await SymbolService.announceTxWithCosignatures(signedTx, []);
        const results = await SymbolService.waitTxsFor(signerAccount, signedTx.hash, "confirmed");
        if (results.filter((result) => result.error).length) {
            throw new Error("Failed to announce call transaction.");
        }
    };

    export const fulfill = async (callTxPayload: CallTransactionPayload) => {
        const { networkType } = await SymbolService.getNetwork();

        const callerPubAccount = PublicAccount.createFromPublicKey(callTxPayload.signer_public_key, networkType);
        const smartyTx = AggregateTransaction.createComplete(
            deadline,
            transactions,
            networkType,
            [],
            UInt64.fromNumericString(callTxPayload.max_fee),
            callTxPayload.signature,
            callerPubAccount
        );

        const signedTx = await createSignedTx(smartyTx);
        const cosignature = CosignatureTransaction.signTransactionHash(signerAccount, signedTx.hash);
        await SymbolService.announceTxWithCosignatures(signedTx, [ cosignature ]);
        const results = await SymbolService.waitTxsFor(callerPubAccount, signedTx.hash, "confirmed");
        if (results.filter((result) => result.error).length) {
            throw new Error("Failed to announce call transaction.");
        }
    };

    // WASM Import functions (Symbol libs)

    global.getAccountBalance = async (account: string, mosaic_id: string): Promise<number> => {
        const { networkType, repositoryFactory } = await SymbolService.getNetwork();
        const accountHttp = repositoryFactory.createAccountRepository();
        const mosaicIdObj = new MosaicId(mosaic_id);

        return firstValueFrom(accountHttp.getAccountInfo(PublicAccount.createFromPublicKey(account, networkType).address))
            .then((accountInfo) =>
                accountInfo.mosaics
                    .filter((mosaic) => mosaic.id.equals(mosaicIdObj))
                    .reduce((acc, curr) => acc + Number(curr.amount.toString()), 0)
            );
    };

    global.transferMosaic = async (from: string, to: string, mosaic_id: string, amount: number, message: string) => {
        const { networkType } = await SymbolService.getNetwork();
        const recipientPubAccount = PublicAccount.createFromPublicKey(to, networkType);
        const senderPubAccount = PublicAccount.createFromPublicKey(from, networkType);

        const transferTx = TransferTransaction.create(
            deadline,
            recipientPubAccount.address,
            [ new Mosaic(new MosaicId(mosaic_id), UInt64.fromUint(amount)) ],
            PlainMessage.create(message),
            networkType
        ).toAggregate(senderPubAccount);

        addTx(transferTx);
    };
}