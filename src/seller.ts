import dotenv from "dotenv";
dotenv.config();

import {Logger, MetalService, SymbolService} from "metal-on-symbol";
import assert from "assert";
import init, { exchange } from "simple-exchange-wasm/simple_exchange_wasm.js";
import {SmartTransactionService} from "./services/index.js";
import {Account, AggregateTransaction, Deadline, Transaction, TransactionType, TransferTransaction} from "symbol-sdk";


assert(process.env.SELLER_PRIVATE_KEY);
const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY;

assert(process.env.NODE_URL);
const symbolService = new SymbolService({ node_url: process.env.NODE_URL });
const metalService = new MetalService(symbolService);
Logger.init({ log_level: Logger.LogLevel.DEBUG });

const parseCallTxPayload = (payload: string) => {
    try {
        const callTxPayload = JSON.parse(payload);
        if (!SmartTransactionService.isCallTransactionPayload(callTxPayload)) {
            return undefined;
        }
        return callTxPayload;
    } catch (e) {
        return undefined;
    }
};

const handleCallerTx = async (account: Account, tx: TransferTransaction) => {
    try {
        const callTxPayload = parseCallTxPayload(tx.message.payload);
        if (!callTxPayload) {
            return;
        }
        console.log(`Call transaction received: ${tx.message.payload}`)

        // Fetch smart transaction
        console.log(`Loading smart transaction from Metal: ${callTxPayload.metal_id}`);
        const smartTx = await metalService.fetchByMetalId(callTxPayload.metal_id);

        // Check smart transaction ownership
        if (!smartTx.targetAddress.equals(account.address)) {
            console.error(`${callTxPayload.metal_id}: Not owned smart transaction.`);
            return;
        }

        // Init smart transaction
        const smartTxService = new SmartTransactionService(
            symbolService,
            account,
            callTxPayload.metal_id,
            smartTx.targetAddress,
            Deadline.createFromAdjustedValue(callTxPayload.deadline),
        );
        global.symbolLibrary = smartTxService;

        // Execute smart transaction
        console.log("Executing smart transaction.");
        await init(smartTx.payload);
        const result = await exchange(callTxPayload.call_data.arguments[0], callTxPayload.call_data.arguments[1]);
        if (!result) {
            console.error("Smart transaction execution failed.");
            return;
        }

        // Cosign and announce transaction
        console.log("Validating and fulfilling call of smart transaction.");
        await smartTxService.fulfill(callTxPayload);

        console.log("Handling of call transaction completed.");
    } catch (e) {
        console.error(e);
    }
};

const main = async () => {
    const { networkType, repositoryFactory } = await symbolService.getNetwork();
    const sellerAccount = Account.createFromPrivateKey(sellerPrivateKey, networkType);

    const isTransferTransaction =
        (tx: Transaction): tx is TransferTransaction => tx.type === TransactionType.TRANSFER;
    const isAggregateCompleteTransaction =
        (tx: Transaction): tx is AggregateTransaction => tx.type === TransactionType.AGGREGATE_COMPLETE;

    // Listen call transaction
    console.log("Starting call transaction listener.");
    const listener = repositoryFactory.createListener();
    await listener.open();
    return new Promise(() => {
        listener.confirmed(sellerAccount.address)
            .subscribe({
                next: async (fetchedTx) => {
                    const innerTxs = isAggregateCompleteTransaction(fetchedTx)
                        ? fetchedTx.innerTransactions
                        : [ fetchedTx ];
                    for (const tx of innerTxs) {
                        if (!isTransferTransaction(tx)) {
                            continue;
                        }
                        await handleCallerTx(sellerAccount, tx);
                    }
                },
                error: (e) => {
                    console.error(e);
                }
            });
    });
};

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
