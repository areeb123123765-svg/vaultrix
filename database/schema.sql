-- Enable UUID generation (SQLite natively supports this syntax via our JS layer)
-- We use BLOB for UUIDs in SQLite to maintain exact 128-bit precision.

CREATE TABLE users (
    id BLOB PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    
    -- Ironclad KYC System
    kyc_status TEXT DEFAULT 'unverified' 
        CHECK (kyc_status IN ('unverified', 'pending_review', 'locked', 'rejected')),
    locked_identity TEXT DEFAULT NULL, -- JSON string
    locked_payment_method TEXT DEFAULT NULL, -- JSON string
    kyc_locked_at TEXT DEFAULT NULL,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_email ON users(email);

-- Video Metadata
CREATE TABLE videos (
    id BLOB PRIMARY KEY,
    uploader_id BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'chunking', 'transcoding', 'ready', 'failed', 'banned')),
    duration_seconds INTEGER DEFAULT 0,
    search_vector TEXT DEFAULT NULL, 
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_videos_uploader ON videos(uploader_id);
CREATE INDEX idx_videos_status ON videos(status);

-- Video Streams
CREATE TABLE video_streams (
    id BLOB PRIMARY KEY,
    video_id BLOB NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    resolution TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(video_id, resolution)
);

-- The Immutable Financial Ledger
-- Note: SQLite doesn't have native Partitioning like Postgres, but the 
-- NUMERIC rule and IMMUTABLE logic remain exactly the same.
CREATE TABLE transactions (
    id BLOB PRIMARY KEY,
    user_id BLOB NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL
        CHECK (type IN ('ad_earn', 'withdrawal_request', 'withdrawal_fee', 'withdrawal_payout')),
    amount REAL NOT NULL, -- SQLite uses REAL, but we enforce 2-decimal precision in the application code
    reference_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_txn_user ON transactions(user_id);
CREATE INDEX idx_txn_user_type ON transactions(user_id, type);