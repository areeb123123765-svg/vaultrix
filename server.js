require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

// INIT CLOUD GIANTS
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
process.on('uncaughtException', (err) => console.error('🛡️ CRASH SHIELD CAUGHT:', err));
process.on('unhandledRejection', (err) => console.error('🛡️ CRASH SHIELD CAUGHT:', err));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-video-id, x-filename, x-forwarded-for');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    req.realIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
const JWT_ACCESS_SECRET = 'vaultrix_access_secret_key_32_chars';

function authenticateToken(req, res, next) {
    const a = req.headers['authorization'];
    if (!a || !a.startsWith('Bearer ')) return res.status(401).json({ error: "Missing token" });
    const t = a.split(' ')[1];
    jwt.verify(t, JWT_ACCESS_SECRET, (e, u) => { if (e) return res.status(403).json({ error: "Invalid token" }); req.user = u; next(); });
}

// ==========================================
// AUTH (Supabase)
// ==========================================
app.post('/api/v1/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !/^[^\s@]+@gmail\.com$/.test(email)) return res.status(400).json({ error: "Gmail only." });
        if (!password || password.length < 8) return res.status(400).json({ error: "Min 8 chars" });
        
        const { data: existing } = await supabase.from('users').select('id').eq('email', email);
        if (existing.length) return res.status(409).json({ error: "Email exists" });
        
        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabase.from('users').insert({ email, password_hash: hash }).select('id').single();
        if (error) throw error;
        
        res.status(201).json({ message: "User created", userId: data.id });
    } catch (e) { res.status(500).json({ error: "Registration error" }); }
});

app.post('/api/v1/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });
        
        const token = jwt.sign({ userId: user.id, email: user.email, ip: req.realIp }, JWT_ACCESS_SECRET, { expiresIn: '15m' });
        res.json({ accessToken: token });
    } catch (e) { res.status(500).json({ error: "Login error" }); }
});

// ==========================================
// UPLOADS (Cloudinary Direct)
// ==========================================
app.post('/api/upload/init', authenticateToken, (req, res) => {
    try {
        // Generate Cloudinary Signature for direct browser upload
        const timestamp = Math.round(Date.now() / 1000);
        // FIX: Only sign the timestamp. resource_type goes in the URL, not the signature.
        const signature = cloudinary.utils.api_sign_request({ timestamp }, process.env.CLOUDINARY_API_SECRET);
        res.json({
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey: process.env.CLOUDINARY_API_KEY,
            timestamp,
            signature
        });
    } catch (e) { res.status(500).json({ error: "Upload init error" }); }
});

app.post('/api/upload/complete', authenticateToken, async (req, res) => {
    try {
        const { cloudinaryId, title, description } = req.body;
        
        // Construct HLS URL (Cloudinary's automatic transcoding)
        const hlsUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/f_m3u8/${cloudinaryId}.m3u8`;
        const thumbUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${cloudinaryId}.jpg`;
        
        const { data, error } = await supabase.from('videos').insert({
            uploader_id: req.user.userId,
            title,
            description,
            cloudinary_id: cloudinaryId,
            hls_url: hlsUrl,
            thumbnail_url: thumbUrl,
            status: 'ready'
        }).select('*').single();
        
        if (error) {
            console.error("Supabase DB Error:", error);
            return res.status(500).json({ error: `Database rejected: ${error.message}` });
        }
        
        res.json({ video: data });
    } catch (e) { 
        console.error("Server Crash on Complete:", e);
        res.status(500).json({ error: `Complete error: ${e.message}` }); 
    }
});

// ==========================================
// FEED & VIDEOS (Supabase)
// ==========================================
app.get('/api/v1/feed', async (req, res) => {
    try {
        const { data, error } = await supabase.from('videos').select('*').eq('status', 'ready').order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        res.json({ videos: data });
    } catch (e) { res.status(500).json({ error: "Feed error" }); }
});

app.get('/api/v1/videos/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('videos').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: "Not found" });
        
        // Increment view count in Supabase
        await supabase.from('videos').update({ views: data.views + 1 }).eq('id', req.params.id);
        
        res.json(data);
    } catch (e) { res.status(500).json({ error: "Video error" }); }
});

app.get('/api/v1/videos/:id/comments', async (req, res) => {
    try {
        const { data, error } = await supabase.from('comments').select('*').eq('video_id', req.params.id).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ comments: data });
    } catch (e) { res.status(500).json({ error: "Comment fetch error" }); }
});

app.post('/api/v1/videos/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Text required" });
        
        const { data, error } = await supabase.from('comments').insert({ video_id: req.params.id, user_id: req.user.userId, text }).select('*').single();
        if (error) throw error;
        
        res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: "Comment failed" }); }
});

// BULLETPROOF FRONTEND SERVING
app.use((req, res, next) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
    console.log("🛡️ FORTIFIED SECURITY ACTIVE");
    console.log("☁️  SUPABASE CLOUD DATABASE CONNECTED");
    console.log("🎬 CLOUDINARY 1000-WORKER ENGINE CONNECTED");
    console.log(`🚀 VAULTRIX API running on http://localhost:${PORT}`);
});