import { CommitmentLevel, SubscribeRequest } from "@triton-one/yellowstone-grpc";
import { Connection, PublicKey } from "@solana/web3.js";
import pino from "pino";
import fs from 'fs'

// import dotenv from 'dotenv'
// dotenv.config()

// import bs58 from 'bs58';
// const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
// const solanaConnection = new Connection(RPC_ENDPOINT, {
//   wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
// });

const transport = pino.transport({
    target: 'pino-pretty',
});

export const logger = pino(
    {
        level: 'info',
        serializers: {
            error: pino.stdSerializers.err,
        },
        base: undefined,
    },
    transport,
);


import Client from "@triton-one/yellowstone-grpc";
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { bufferRing } from "./openbook";
import { buy, sellToken } from "../transaction/transaction";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";

// uncomment this line to enable Jito leader schedule check and delete the return line.
function slotExists(slot: number): boolean {
    //return leaderSchedule.has(slot);
    return true
}

const client = new Client("https://grpc.solanavibestation.com", undefined, undefined); //grpc endpoint from Solana Vibe Station obviously

(async () => {
    const version = await client.getVersion(); // gets the version information
    console.log(version);
})();

// let latestBlockHash: string = "";

export async function streamNewTokens() {
    const stream = await client.subscribe();
    // Collecting all incoming events.
    stream.on("data", async (data) => {

        const result = await handleData(data)
        if (result) {
            stream.end();
        }
    });

    // Create a subscription request.
    const request: SubscribeRequest = {
        "slots": {},
        "accounts": {
            "raydium": {
                "account": [],
                "filters": [
                    {
                        "memcmp": {
                            "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint').toString(), // Filter for only tokens paired with SOL
                            "base58": "So11111111111111111111111111111111111111112"
                        }
                    },
                    {
                        "memcmp": {
                            "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId').toString(), // Filter for only Raydium markets that contain references to Serum
                            "base58": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
                        }
                    },
                    {
                        "memcmp": {
                            "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapQuoteInAmount').toString(), // Hack to filter for only new tokens. There is probably a better way to do this
                            "bytes": Uint8Array.from([0])
                        }
                    },
                    {
                        "memcmp": {
                            "offset": LIQUIDITY_STATE_LAYOUT_V4.offsetOf('swapBaseOutAmount').toString(), // Hack to filter for only new tokens. There is probably a better way to do this
                            "bytes": Uint8Array.from([0])
                        }
                    }
                ],
                "owner": ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"] // raydium program id to subscribe to
            }
        },
        "transactions": {},
        "blocks": {},
        "blocksMeta": {
            "block": []
        },
        "accountsDataSlice": [],
        "commitment": CommitmentLevel.PROCESSED,  // Subscribe to processed blocks for the fastest updates
        entry: {}
    }

    // Sending a subscription request.
    await new Promise<void>((resolve, reject) => {
        stream.write(request, (err: null | undefined) => {
            if (err === null || err === undefined) {
                resolve();
            } else {
                reject(err);
            }
        });
    }).catch((reason) => {
        console.error(reason);
        throw reason;
    });
}


export const saveToJSONFile = (filePath: string, data: object): boolean => {
    // Convert data object to JSON string
    const jsonData = JSON.stringify(data, null, 2);  // The `null, 2` argument formats the JSON with indentation
    fs.writeFileSync(filePath, jsonData, 'utf8');
    console.log('Data saved to JSON file.');
    return true;
};


let isStopped = false;

async function handleData(data: any) {

    if (isStopped) {
        return; // Skip processing if the stream is stopped
    }
    // if (data.blockMeta) {
    //   latestBlockHash = data.blockMeta.blockhash;
    // }

    if (data.account != undefined) {
        logger.info(`New token alert!`);
        isStopped = true;

        console.log("data ----------------->", data);
        saveToJSONFile("mint.json", data);


        const poolstate = LIQUIDITY_STATE_LAYOUT_V4.decode(data.account.account.data);
        const tokenMint = new PublicKey(data.account.account.pubkey);
        logger.info(`Token Account: ${tokenMint}`);
        console.log("Token Account in Dexscreen => ", `https://dexscreener.com/solana/${tokenMint}`, '\n');


        let attempts = 0;
        const maxAttempts = 2;
        let marketDetailsDecoded: any;

        while (attempts < maxAttempts) {
            const marketDetails = bufferRing.findPattern(poolstate.baseMint);

            if (Buffer.isBuffer(marketDetails)) {
                const fullMarketDetailsDecoded = MARKET_STATE_LAYOUT_V3.decode(marketDetails);
                if (fullMarketDetailsDecoded) {
                    marketDetailsDecoded = {
                        bids: fullMarketDetailsDecoded.bids,
                        asks: fullMarketDetailsDecoded.asks,
                        eventQueue: fullMarketDetailsDecoded.eventQueue,
                    };

                    console.log("marketDetailsDecoded1======>", marketDetailsDecoded);
                    break; // Break the loop if market details are successfully decoded
                }
            }

            attempts++;
            if (attempts >= maxAttempts) {
                logger.error("Invalid market details");
            } else {
                // Wait for 10ms before the next attempt
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        console.log("marketDetailsDecoded2======>", marketDetailsDecoded);

        // Perform the action if market details are successfully fetched
        if (marketDetailsDecoded) {
            let buyResult = await buy(tokenMint, poolstate, marketDetailsDecoded);
            if (buyResult?.solBuyPrice) {

                console.log("buyprice===============>", buyResult.solBuyPrice);

                // await sellToken(poolstate, buyResult.solBuyPrice, buyResult.poolKeys)
            }
        }

    }

    isStopped = false;
    return true
}