require('dotenv').config();
const LitManager = require('./lit-manager');

async function main() {
    const litManager = new LitManager(process.env.RELAYER_PRIVATE_KEY);
    await litManager.connect();
    
    // Encrypt dummy payload
    const enc = await litManager.encryptPasswordShare("dummy secret payload", "0x0000000000000000000000000000000000000000000000000000000000000001", "0x9D262070DbEc668B74eE328397F7A217569C69E1");
    // Since we mock the fuji call just now we cannot directly decrypt unless vault is claimable.
    // wait we can test what decrypt returns if we use the old payload from our previous test!
    console.log("We need a payload we can actually decrypt.");
}
main();
