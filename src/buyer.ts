import dotenv from "dotenv";
dotenv.config();

import metal from "./metal.json" assert { type: "json" };
import {Logger, MetalService, SymbolService} from "metal-on-symbol";
import assert from "assert";
import init, { exchange } from "simple-exchange-wasm/simple_exchange_wasm.js";
import {SmartTransactionService} from "./services/SmartTransactionService.js";
import {Account} from "symbol-sdk";


const buyAmount = 2.0;

assert(process.env.BUYER_PRIVATE_KEY);
const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY;

assert(process.env.NODE_URL);
SymbolService.init({ node_url: process.env.NODE_URL, logging: true })
Logger.init({ log_level: Logger.LogLevel.DEBUG });

const main = async () => {
    const { networkType } = await SymbolService.getNetwork();

    // Fetch smart transaction
    console.log(`Loading smart transaction from Metal: ${metal.metalId}`);
    //const smartTx = {
    //    payload: fs.readFileSync("./webasm/simple-exchange/pkg/simple_exchange_wasm_bg.wasm"),
    //    targetAddress: Address.createFromPublicKey(metal.targetPublicKey, networkType),
    //};
    const smartTx = await MetalService.fetchByMetalId(metal.metalId);

    // Init smart transaction
    const buyerAccount = Account.createFromPrivateKey(buyerPrivateKey, networkType);
    await SmartTransactionService.init(buyerAccount, metal.metalId, smartTx.targetAddress);

    // Execute smart transaction
    console.log("Executing smart transaction.");
    await init(smartTx.payload);
    const result = await exchange(buyerAccount.publicKey, buyAmount);
    if (!result) {
        throw new Error("Smart transaction execution failed.");
    }

    // Announce call transaction
    console.log("Announcing call transaction.");
    const callData = {
        method_name: "exchange",
        arguments: [ buyerAccount.publicKey, buyAmount ],
    };
    await SmartTransactionService.call(callData);
};

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
