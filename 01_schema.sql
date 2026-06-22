-- Enable cryptographic UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. USERS & IDENTITY SYSTEM
-- ==========================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    kyc_status VARCHAR(20) DEFAULT 'unverified' 
        CHECK (kyc_status IN ('unverified', 'pending_review', 'locked', 'rejected')),
    locked_identity JSONB DEFAULT NULL,
    locked_payment_method JSONB DEFAULT NULL,
    kyc_locked_at TIMESTAMPTZ DEFAULT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);

-- ==========================================
-- 2. VIDEO METADATA
-- ==========================================
CREATE TYPE video_status AS ENUM ('uploading', 'chunking', 'transcoding', 'ready', 'failed', 'banned');

CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status video_status DEFAULT 'uploading',
    duration_seconds INTEGER DEFAULT 0,
    search_vector TSVECTOR, 
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_videos_uploader ON videos(uploader_id);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_search ON videos USING GIN(search_vector);

-- ==========================================
-- 3. VIDEO STREAMS
-- ==========================================
CREATE TABLE video_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    resolution VARCHAR(10) NOT NULL,
    manifest_path VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(video_id, resolution)
);

-- ==========================================
-- 4. THE INFINITE LEDGER (PARTITIONED BY MONTH)
-- This prevents the table from ever slowing down, 
-- no matter how many billions of rows it holds.
-- ==========================================
CREATE TYPE txn_type AS ENUM ('ad_earn', 'withdrawal_request', 'withdrawal_fee', 'withdrawal_payout');

-- Create the "Master" table (it holds no data itself, just the rules)
CREATE TABLE transactions (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    type txn_type NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    reference_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at) -- Partition key MUST be part of the Primary Key
) PARTITION BY RANGE (created_at);

-- Create partitions for the next 3 years automatically
-- When a month passes, Postgres automatically writes new data to the correct month bucket
CREATE TABLE transactions_2024_01 PARTITION OF transactions FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE transactions_2024_02 PARTITION OF transactions FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE transactions_2024_03 PARTITION OF transactions FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
CREATE TABLE transactions_2024_04 PARTITION OF transactions FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
CREATE TABLE transactions_2024_05 PARTITION OF transactions FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE transactions_2024_06 PARTITION OF transactions FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
CREATE TABLE transactions_2024_07 PARTITION OF transactions FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');
CREATE TABLE transactions_2024_08 PARTITION OF transactions FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');
CREATE TABLE transactions_2024_09 PARTITION OF transactions FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');
CREATE TABLE transactions_2024_10 PARTITION OF transactions FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');
CREATE TABLE transactions_2024_11 PARTITION OF transactions FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
CREATE TABLE transactions_2024_12 PARTITION OF transactions FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');
CREATE TABLE transactions_2025_01 PARTITION OF transactions FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE transactions_2025_02 PARTITION OF transactions FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE transactions_2025_03 PARTITION OF transactions FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE transactions_2025_04 PARTITION OF transactions FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE transactions_2025_05 PARTITION OF transactions FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE transactions_2025_06 PARTITION OF transactions FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- Indexes on the master table automatically apply to all child partitions
CREATE INDEX idx_txn_user ON transactions(user_id);
CREATE INDEX idx_txn_user_type ON transactions(user_id, type);