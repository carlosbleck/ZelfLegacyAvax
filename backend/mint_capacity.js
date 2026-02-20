require('dotenv').config();
const { LitContracts } = require('@lit-protocol/contracts-sdk');
const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider("https://yellowstone-rpc.litprotocol.com");
    const wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const contractClient = new LitContracts({
        signer: wallet,
        network: "datil-dev"
    });
    await contractClient.connect();

    console.log("Minting Capacity Credits NFT bridging to wallet...");
    const mintRes = await contractClient.mintCapacityCreditsNFT({
        requestsPerKilosecond: 10,
        daysUntilUTCMidnightExpiration: 2,
    });
    console.log("Capacity Token ID:", mintRes.capacityTokenIdStr);
}
main().catch(console.error);
