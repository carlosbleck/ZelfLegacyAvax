const IPFSManager = require('./ipfs-manager');
require('dotenv').config();

async function main() {
    const mgr = new IPFSManager(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);
    // Let's create a test object, upload it, then retrieve it
    const testCid = await mgr.uploadJSON({ test: "hello" }, "test-upload");
    console.log("Uploaded:", testCid);
    const data = await mgr.retrieve(testCid);
    console.log("Retrieved type:", typeof data, "Data:", data);
}
main().catch(console.error);
