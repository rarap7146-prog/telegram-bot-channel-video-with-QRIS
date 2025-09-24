-- Bot-Creator-Papa Multi-Tenant Database Schema
-- MySQL Database for content creator channel management

CREATE DATABASE IF NOT EXISTS bot_creator_papa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bot_creator_papa;

-- Create database user
CREATE USER IF NOT EXISTS 'bot_creator'@'localhost' IDENTIFIED BY 'Titikdua93*';
GRANT ALL PRIVILEGES ON bot_creator_papa.* TO 'bot_creator'@'localhost';
FLUSH PRIVILEGES;

-- Users table: Store user accounts and their basic info
CREATE TABLE users (
    id BIGINT PRIMARY KEY,                    -- Telegram User ID
    username VARCHAR(255),                    -- Telegram username (can be null)
    first_name VARCHAR(255),                  -- User's first name
    last_name VARCHAR(255),                   -- User's last name (can be null)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    
    INDEX idx_username (username),
    INDEX idx_created_at (created_at)
);

-- Channels table: Store channel configurations
CREATE TABLE channels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                  -- Owner of this channel
    channel_username VARCHAR(255) NOT NULL,   -- @channelname format
    channel_id VARCHAR(255),                  -- Actual Telegram channel ID (filled after verification)
    channel_title VARCHAR(500),              -- Channel title (filled after verification)
    oy_api_key VARCHAR(500),                 -- OY Indonesia API key (encrypted)
    bot_admin_status ENUM('pending', 'verified', 'failed') DEFAULT 'pending',
    tech_support_invited BOOLEAN DEFAULT FALSE,
    setup_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_channel_user (channel_username, user_id),
    INDEX idx_user_id (user_id),
    INDEX idx_channel_username (channel_username),
    INDEX idx_setup_completed (setup_completed)
);

-- User balances per channel: Each user has separate balance for each channel
CREATE TABLE user_channel_balances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                  -- User who owns the balance
    channel_id INT NOT NULL,                  -- Channel this balance is for
    balance_amount DECIMAL(12,2) DEFAULT 0.00, -- Current balance in IDR
    total_topup DECIMAL(12,2) DEFAULT 0.00,   -- Total amount topped up
    total_spent DECIMAL(12,2) DEFAULT 0.00,   -- Total amount spent
    last_topup_at TIMESTAMP NULL,            -- Last top-up timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_channel_balance (user_id, channel_id),
    INDEX idx_user_id (user_id),
    INDEX idx_channel_id (channel_id),
    INDEX idx_balance_amount (balance_amount)
);

-- Promo settings per channel: Discount and bonus configurations
CREATE TABLE channel_promos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    channel_id INT NOT NULL,                  -- Channel this promo applies to
    promo_type ENUM('discount', 'topup_bonus') NOT NULL,
    
    -- Discount settings (percentage off all videos)
    discount_percentage DECIMAL(5,2) DEFAULT 0.00, -- e.g., 10.50 for 10.5%
    
    -- Top-up bonus settings (top up X get Y bonus)
    bonus_min_topup DECIMAL(10,2) DEFAULT 0.00,    -- Minimum top-up amount
    bonus_percentage DECIMAL(5,2) DEFAULT 0.00,     -- Bonus percentage
    
    -- Promo validity
    is_active BOOLEAN DEFAULT TRUE,
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,                -- NULL means no expiry
    
    -- Usage limits
    max_uses_per_user INT DEFAULT NULL,      -- NULL means unlimited
    total_max_uses INT DEFAULT NULL,         -- NULL means unlimited
    current_uses INT DEFAULT 0,             -- Track total usage
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    INDEX idx_channel_id (channel_id),
    INDEX idx_promo_type (promo_type),
    INDEX idx_is_active (is_active),
    INDEX idx_expires_at (expires_at)
);

-- Track individual promo usage per user
CREATE TABLE promo_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    promo_id INT NOT NULL,
    user_id BIGINT NOT NULL,
    channel_id INT NOT NULL,
    usage_count INT DEFAULT 1,
    total_savings DECIMAL(10,2) DEFAULT 0.00, -- Total amount saved/gained
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (promo_id) REFERENCES channel_promos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    UNIQUE KEY unique_promo_user (promo_id, user_id),
    INDEX idx_promo_id (promo_id),
    INDEX idx_user_id (user_id),
    INDEX idx_channel_id (channel_id)
);

-- Media content table: Store uploaded videos and images
CREATE TABLE media_content (
    id INT AUTO_INCREMENT PRIMARY KEY,
    channel_id INT NOT NULL,                  -- Which channel this content belongs to
    user_id BIGINT NOT NULL,                  -- Who uploaded this content
    
    -- Media files
    video_file_id VARCHAR(255) NOT NULL,     -- Telegram video file ID
    image_file_id VARCHAR(255),              -- Telegram image file ID (thumbnail/preview)
    video_duration INT DEFAULT 0,            -- Video duration in seconds
    
    -- Pricing and content
    base_price_idr DECIMAL(10,2) NOT NULL,   -- Base price in Indonesian Rupiah
    caption TEXT NOT NULL,                   -- Content description
    raw_caption TEXT NOT NULL,               -- Original caption with #price#format
    
    -- Publishing status
    preview_posted BOOLEAN DEFAULT FALSE,    -- Has preview been posted to channel?
    post_status ENUM('draft', 'pending_approval', 'published', 'rejected') DEFAULT 'draft',
    channel_message_id INT DEFAULT NULL,     -- Message ID in the channel
    
    -- Statistics
    view_count INT DEFAULT 0,                -- How many times accessed
    purchase_count INT DEFAULT 0,            -- How many times purchased
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_channel_id (channel_id),
    INDEX idx_user_id (user_id),
    INDEX idx_post_status (post_status),
    INDEX idx_base_price (base_price_idr),
    INDEX idx_created_at (created_at)
);

-- Media processing queue: Track media upload batches (media groups)
CREATE TABLE media_upload_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    channel_id INT NOT NULL,
    media_group_id VARCHAR(255),             -- Telegram media group ID
    session_status ENUM('collecting', 'ready', 'processed', 'failed') DEFAULT 'collecting',
    collected_files JSON,                    -- Store file IDs temporarily
    raw_caption TEXT,                        -- Caption from media group
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL 5 MINUTE),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    INDEX idx_user_channel (user_id, channel_id),
    INDEX idx_media_group_id (media_group_id),
    INDEX idx_expires_at (expires_at)
);

-- Settings table: Store various bot configuration per user/channel
CREATE TABLE user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    channel_id INT,                          -- Can be NULL for global user settings
    setting_key VARCHAR(100) NOT NULL,      -- e.g., 'auto_post', 'notification_enabled'
    setting_value JSON,                     -- Flexible value storage
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_channel_setting (user_id, channel_id, setting_key),
    INDEX idx_user_setting (user_id, setting_key)
);

-- Activity logs for debugging and monitoring
CREATE TABLE activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT,
    channel_id INT,
    activity_type VARCHAR(50) NOT NULL,     -- 'setup', 'upload', 'publish', 'error', 'promo', 'topup'
    description TEXT,
    metadata JSON,                          -- Additional context
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
    INDEX idx_user_activity (user_id, activity_type),
    INDEX idx_created_at (created_at)
);

-- Create read-only user for bot-content-papa
CREATE USER IF NOT EXISTS 'bot_content_readonly'@'localhost' IDENTIFIED BY 'readonly_papa_2024!';
GRANT SELECT ON bot_creator_papa.channels TO 'bot_content_readonly'@'localhost';
GRANT SELECT ON bot_creator_papa.media_content TO 'bot_content_readonly'@'localhost';
GRANT SELECT ON bot_creator_papa.users TO 'bot_content_readonly'@'localhost';
GRANT SELECT ON bot_creator_papa.user_channel_balances TO 'bot_content_readonly'@'localhost';
GRANT SELECT ON bot_creator_papa.channel_promos TO 'bot_content_readonly'@'localhost';
GRANT SELECT ON bot_creator_papa.promo_usage TO 'bot_content_readonly'@'localhost';
FLUSH PRIVILEGES;

-- Sample indexes for performance optimization
CREATE INDEX idx_media_price_range ON media_content(base_price_idr, post_status);
CREATE INDEX idx_channel_active_content ON media_content(channel_id, post_status, created_at);
CREATE INDEX idx_active_promos ON channel_promos(channel_id, is_active, expires_at);

-- Sample data for testing (optional)
INSERT INTO users (id, username, first_name) VALUES 
(7761064473, 'titokt78', 'Tito'),
(123456789, 'testuser', 'Test User');

INSERT INTO channels (user_id, channel_username, oy_api_key, setup_completed) VALUES 
(123456789, '@testchannel', 'encrypted_test_key', FALSE);

-- Payment and QRIS tables
CREATE TABLE payment_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE NOT NULL,     -- OY Indonesia transaction ID
    user_id BIGINT NOT NULL,                      -- Who is making the payment
    content_id INT NULL,                          -- Content being purchased (if applicable)
    channel_id INT NULL,                          -- Channel for balance top-up
    amount DECIMAL(10,2) NOT NULL,               -- Payment amount
    purpose ENUM('content_purchase', 'balance_topup') NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'qris',   -- Payment method used
    status ENUM('pending', 'paid', 'failed', 'expired') DEFAULT 'pending',
    qris_url TEXT,                               -- QRIS QR code URL
    expires_at TIMESTAMP NOT NULL,              -- When payment expires
    paid_at TIMESTAMP NULL,                     -- When payment was completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES media_content(id) ON DELETE SET NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
    INDEX idx_external_id (external_id),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_created_at (created_at)
);

CREATE TABLE content_purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                     -- Who purchased the content
    content_id INT NOT NULL,                     -- What content was purchased
    amount DECIMAL(10,2) NOT NULL,              -- Amount paid
    payment_transaction_id INT NULL,             -- Link to payment transaction
    status ENUM('pending', 'completed', 'refunded') DEFAULT 'completed',
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES media_content(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL,
    UNIQUE KEY unique_user_content (user_id, content_id),
    INDEX idx_user_id (user_id),
    INDEX idx_content_id (content_id),
    INDEX idx_purchased_at (purchased_at)
);

CREATE TABLE purchase_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                     -- Who made the purchase
    content_id INT NULL,                         -- Content purchased (if applicable)
    channel_id INT NULL,                         -- Channel for balance top-up
    amount DECIMAL(10,2) NOT NULL,              -- Amount
    payment_method VARCHAR(50) NOT NULL,        -- How they paid
    transaction_type ENUM('content_purchase', 'balance_topup', 'balance_deduct') NOT NULL,
    description TEXT,                           -- Transaction description
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES media_content(id) ON DELETE SET NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at)
);