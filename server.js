require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const app = express();

// ==========================================
// DEFENSE LAYERS: CRASH SHIELD, HELMET, DDoS LIMIT
// ==========================================
process.on('uncaughtException', (err) => console.error('🛡️ CRASH SHIELD:', err));
process.on('unhandledRejection', (err) => console.error('🛡️ CRASH SHIELD:', err));

app.use(helmet({ crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-forwarded-for');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    req.realIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    next();
});

const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 100, message: { error: "Too many requests." } });
app.use(express.json({ limit: '10kb' }));
app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'vaultrix_super_secret_key_32_chars';

function authenticateToken(req, res, next) {
    const a = req.headers['authorization'];
    if (!a || !a.startsWith('Bearer ')) return res.status(401).json({ error: "Missing token" });
    jwt.verify(a.split(' ')[1], JWT_SECRET, (e, u) => { if (e) return res.status(403).json({ error: "Invalid token" }); req.user = u; next(); });
}

// ==========================================
// AUTHENTICATION (Strict Validation)
// ==========================================
app.post('/api/v1/auth/register', [
    body('email').isEmail().matches(/^[^\s@]+@gmail\.com$/).withMessage('Gmail only.'),
    body('password').isStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }).withMessage('Weak password. Need 8+ chars, Upper, Lower, Number, Symbol.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const { email, password } = req.body;
        const { data: existing } = await supabase.from('users').select('id').eq('email', email);
        if (existing.length) return res.status(409).json({ error: "Email exists" });
        
        const hash = await bcrypt.hash(password, 12); // High salt rounds for extreme security
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
        
        if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
        
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '15m' });
        res.json({ accessToken: token });
    } catch (e) { res.status(500).json({ error: "Login error" }); }
});

// ==========================================
// UPLOADS (Cloudinary Direct + Validation)
// ==========================================
app.post('/api/upload/init', authenticateToken, (req, res) => {
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request({ timestamp }, process.env.CLOUDINARY_API_SECRET);
    res.json({ cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, timestamp, signature });
});

app.post('/api/upload/complete', authenticateToken, [
    body('title').isLength({ min: 1, max: 100 }).withMessage('Title must be 1-100 chars'),
    body('cloudinaryId').isString().isLength({ min: 10, max: 100 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const { cloudinaryId, title, description } = req.body;
        const hlsUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/f_m3u8/${cloudinaryId}.m3u8`;
        const thumbUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${cloudinaryId}.jpg`;
        
        const { data, error } = await supabase.from('videos').insert({
            uploader_id: req.user.userId, title, description: description || '', 
            cloudinary_id: cloudinaryId, hls_url: hlsUrl, thumbnail_url: thumbUrl, status: 'ready'
        }).select('*').single();
        
        if (error) return res.status(500).json({ error: `Database rejected: ${error.message}` });
        res.json({ video: data });
    } catch (e) { res.status(500).json({ error: "Complete error" }); }
});

// ==========================================
// FEED & VIDEOS
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
        await supabase.from('videos').update({ views: data.views + 1 }).eq('id', req.params.id);
        res.json(data);
    } catch (e) { res.status(500).json({ error: "Video error" }); }
});

// ==========================================
// COMMENTS (Strict Length Limit)
// ==========================================
app.get('/api/v1/videos/:id/comments', async (req, res) => {
    try {
        const { data } = await supabase.from('comments').select('*').eq('video_id', req.params.id).order('created_at', { ascending: false });
        res.json({ comments: data || [] });
    } catch (e) { res.status(500).json({ error: "Fetch error" }); }
});

app.post('/api/v1/videos/:id/comments', authenticateToken, [
    body('text').isLength({ min: 1, max: 500 }).withMessage('Comment must be 1-500 chars')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const { data, error } = await supabase.from('comments').insert({ video_id: req.params.id, user_id: req.user.userId, text: req.body.text }).select('*').single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: "Comment failed" }); }
});

// ==========================================
// THE UNCHEATABLE LIKE SYSTEM (Anti-Cheat Logic)
// ==========================================
app.post('/api/v1/videos/:id/like', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'like' or 'dislike'
        const userId = req.user.userId;

        if (!['like', 'dislike'].includes(type)) return res.status(400).json({ error: "Invalid type" });

        // 1. Check if user already liked/disliked
        const { data: existing } = await supabase.from('video_likes').select('type').eq('user_id', userId).eq('video_id', id).single();
        const { data: video } = await supabase.from('videos').select('likes, dislikes').eq('id', id).single();
        if (!video) return res.status(404).json({ error: "Video not found" });

        let newLikes = video.likes;
        let newDislikes = video.dislikes;

        if (existing) {
            if (existing.type === type) {
                // Toggle off (remove like/dislike)
                await supabase.from('video_likes').delete().eq('user_id', userId).eq('video_id', id);
                if (type === 'like') newLikes = Math.max(0, video.likes - 1);
                else newDislikes = Math.max(0, video.dislikes - 1);
            } else {
                // Change from like to dislike or vice versa
                await supabase.from('video_likes').update({ type }).eq('user_id', userId).eq('video_id', id);
                if (type === 'like') { newLikes = video.likes + 1; newDislikes = Math.max(0, video.dislikes - 1); }
                else { newDislikes = video.dislikes + 1; newLikes = Math.max(0, video.likes - 1); }
            }
        } else {
            // New like/dislike
            await supabase.from('video_likes').insert({ user_id: userId, video_id: id, type });
            if (type === 'like') newLikes = video.likes + 1;
            else newDislikes = video.dislikes + 1;
        }

        await supabase.from('videos').update({ likes: newLikes, dislikes: newDislikes }).eq('id', id);
        res.json({ likes: newLikes, dislikes: newDislikes });
    } catch (e) { res.status(500).json({ error: "Like failed" }); }
});

app.use((req, res, next) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 VAULTRIX SECURE API running on port ${PORT}`));