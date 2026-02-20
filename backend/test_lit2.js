require('dotenv').config();
const LitManager = require('./lit-manager');

async function main() {
    const litManager = new LitManager(process.env.RELAYER_PRIVATE_KEY);
    await litManager.connect();
    
    // We will encrypt a test string without any contract conditions just to see if it decrypts
    console.log("Encrypting dummy string...");
    const encrypted = await litManager.litClient.encrypt({
        dataToEncrypt: "test_decrypt_payload",
        accessControlConditions: [
            {
                contractAddress: '',
                standardContractType: '',
                chain: 'fuji',
                method: '',
                parameters: [
                    ':userAddress',
                ],
                returnValueTest: {
                    comparator: '=',
                    value: litManager.litClient.client.config.authContext ? '' : '', // just open to anyone or whatever
                },
            },
        ]
    });
}
main();
