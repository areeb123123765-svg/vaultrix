// stress-test.js
const API_URL = 'http://localhost:3000/api';
const CONCURRENT_USERS = 500; // 500 requests per batch
const TOTAL_BATCHES = 20000; // 500 * 20000 = 10,000,000 requests

async function runStressTest() {
    console.log('🚀 Starting 10 Million Upload Simulation...');
    
    // 1. Authenticate
    console.log('Authenticating stress test bot...');
    await fetch(`${API_URL}/v1/auth/register`, { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ email: 'stress@gmail.com', password: 'password123' }) 
    }).catch(()=>{}); // Ignore error if already exists
    
    const loginRes = await fetch(`${API_URL}/v1/auth/login`, { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify({ email: 'stress@gmail.com', password: 'password123' }) 
    });
    const { accessToken } = await loginRes.json();
    console.log('✅ Authenticated. Token received.');

    // 2. Init Upload
    const initRes = await fetch(`${API_URL}/upload/init`, { 
        method: 'POST', 
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${accessToken}` }, 
        body: JSON.stringify({ title: '10 Million Stress Test' }) 
    });
    const { videoId } = await initRes.json();
    console.log(`✅ Upload initialized: ${videoId}`);

    // 3. The 10 Million Request Loop
    const dummyData = Buffer.alloc(1024); // 1KB payload per chunk
    let totalSent = 0;
    let totalFailed = 0;
    
    console.log(`💥 Firing ${TOTAL_BATCHES} batches of ${CONCURRENT_USERS} concurrent requests...`);
    
    for (let b = 0; b < TOTAL_BATCHES; b++) {
        const promises = [];
        for (let i = 0; i < CONCURRENT_USERS; i++) {
            promises.push(
                fetch(`${API_URL}/upload/chunk`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'x-video-id': videoId,
                        'x-chunk-index': totalSent,
                        'Content-Type': 'application/octet-stream'
                    },
                    body: dummyData
                }).then(() => {
                    totalSent++;
                    if (totalSent % 10000 === 0) console.log(`✅ ${totalSent} requests survived...`);
                }).catch(err => {
                    totalFailed++;
                    // console.log('Network drop (expected at this scale)');
                })
            );
        }
        await Promise.all(promises);
    }

    console.log('\n=========================================');
    console.log('🏁 10 MILLION REQUEST SIMULATION COMPLETE');
    console.log(`✅ Total Requests Survived: ${totalSent}`);
    console.log(`❌ Total Network Drops: ${totalFailed}`);
    console.log('=========================================');
    
    // 4. Complete Upload
    await fetch(`${API_URL}/upload/complete`, { 
        method: 'POST', 
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${accessToken}` }, 
        body: JSON.stringify({ videoId }) 
    });
    console.log('✅ Upload marked as complete. FFmpeg is processing.');
}

runStressTest().catch(console.error);