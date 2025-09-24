const mysql = require('mysql2/promise');
const crypto = require('crypto');

class Database {
    constructor() {
        this.pool = null;
        // The key must be 32 bytes for aes-256. We'll derive it from the env var.
        const secret = process.env.ENCRYPTION_KEY || 'default_secret_must_be_long_enough';
        this.encryptionKey = crypto.createHash('sha256').update(String(secret)).digest('hex').substring(0, 32);
        this.init();
    }

    async init() {
        try {
            this.pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'bot_creator_papa',
                port: parseInt(process.env.DB_PORT) || 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                charset: 'utf8mb4'
            });

            // Test connection
            const connection = await this.pool.getConnection();
            console.log('✅ Database connected successfully');
            connection.release();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            throw error;
        }
    }

    // Encryption helper for sensitive data (OY API keys)
    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedData = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // User management
    async createOrUpdateUser(userData) {
        const { id, username, first_name, last_name } = userData;
        const query = `
            INSERT INTO users (id, username, first_name, last_name, updated_at) 
            VALUES (?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE 
                username = VALUES(username),
                first_name = VALUES(first_name),
                last_name = VALUES(last_name),
                updated_at = NOW()
        `;
        
        const [result] = await this.pool.execute(query, [id, username, first_name, last_name]);
        return result;
    }

    async getUser(userId) {
        const query = 'SELECT * FROM users WHERE id = ? AND is_active = TRUE';
        const [rows] = await this.pool.execute(query, [userId]);
        return rows[0] || null;
    }

    async upsertChannel(userId, channelUsername, oyApiKey) {
        console.log(`[DATABASE] Starting upsert for user ${userId}, channel ${channelUsername}`);
        const encryptedKey = this.encrypt(oyApiKey);
        console.log(`[DATABASE] API key encrypted successfully`);
        
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            console.log(`[DATABASE] Transaction started`);
            
            // First, try to insert. If it fails due to duplicate key, then update.
            let channelId;
            try {
                const insertQuery = `
                    INSERT INTO channels (user_id, channel_username, oy_api_key, created_at, setup_completed) 
                    VALUES (?, ?, ?, NOW(), FALSE)
                `;
                console.log(`[DATABASE] Attempting INSERT...`);
                const [insertResult] = await connection.execute(insertQuery, [userId, channelUsername, encryptedKey]);
                channelId = insertResult.insertId;
                console.log(`[DATABASE] INSERT successful, channelId: ${channelId}`);
            } catch (error) {
                console.log(`[DATABASE] INSERT failed with error: ${error.code} - ${error.message}`);
                if (error.code === 'ER_DUP_ENTRY') {
                    // If duplicate, update the existing record
                    const updateQuery = `
                        UPDATE channels 
                        SET oy_api_key = ?, setup_completed = FALSE, updated_at = NOW()
                        WHERE user_id = ? AND channel_username = ?
                    `;
                    console.log(`[DATABASE] Attempting UPDATE...`);
                    const [updateResult] = await connection.execute(updateQuery, [encryptedKey, userId, channelUsername]);
                    console.log(`[DATABASE] UPDATE result: ${updateResult.affectedRows} rows affected`);
                    
                    // Get the ID of the updated row
                    const [rows] = await connection.execute(
                        'SELECT id FROM channels WHERE user_id = ? AND channel_username = ?',
                        [userId, channelUsername]
                    );
                    channelId = rows[0]?.id;
                    console.log(`[DATABASE] Found existing channelId: ${channelId}`);
                } else {
                    // Re-throw other errors
                    console.log(`[DATABASE] Re-throwing error: ${error.message}`);
                    throw error;
                }
            }
            
            await connection.commit();
            console.log(`[DATABASE] Transaction committed successfully`);
            console.log(`[DATABASE] Upsert completed, returning channelId: ${channelId}`);
            return channelId;

        } catch (error) {
            await connection.rollback();
            console.error('[DATABASE] Upsert channel transaction failed:', error);
            throw error;
        } finally {
            connection.release();
            console.log(`[DATABASE] Connection released`);
        }
    }

    async getUserChannels(userId) {
        const query = `
            SELECT id, channel_username, channel_id, channel_title, 
                   bot_admin_status, tech_support_invited, setup_completed,
                   oy_api_key, created_at, updated_at
            FROM channels 
            WHERE user_id = ? AND is_active = TRUE 
            ORDER BY created_at DESC
        `;
        
        const [rows] = await this.pool.execute(query, [userId]);
        
        // Add decrypted api_key field to each channel
        return rows.map(channel => {
            if (channel.oy_api_key) {
                try {
                    channel.api_key = this.decrypt(channel.oy_api_key);
                } catch (error) {
                    console.error('Failed to decrypt API key for channel:', channel.id, error);
                    channel.api_key = null;
                }
            } else {
                channel.api_key = null;
            }
            return channel;
        });
    }

    async getChannel(channelId) {
        const query = `
            SELECT c.*, u.username as owner_username, u.first_name as owner_name
            FROM channels c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.id = ? AND c.is_active = TRUE
        `;
        
        const [rows] = await this.pool.execute(query, [channelId]);
        if (rows[0] && rows[0].oy_api_key) {
            rows[0].oy_api_key = this.decrypt(rows[0].oy_api_key);
        }
        return rows[0] || null;
    }

    async updateChannelStatus(channelId, updates) {
        const allowedFields = ['channel_id', 'channel_title', 'bot_admin_status', 'tech_support_invited', 'setup_completed'];
        const updateFields = [];
        const values = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });

        if (updateFields.length === 0) return null;

        updateFields.push('updated_at = NOW()');
        values.push(channelId);

        const query = `UPDATE channels SET ${updateFields.join(', ')} WHERE id = ?`;
        const [result] = await this.pool.execute(query, values);
        return result;
    }

    // Media content management
    async createMediaUploadSession(userId, channelId, mediaGroupId = null) {
        const query = `
            INSERT INTO media_upload_sessions (user_id, channel_id, media_group_id, created_at, expires_at)
            VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 5 MINUTE))
        `;
        
        const [result] = await this.pool.execute(query, [userId, channelId, mediaGroupId]);
        return result.insertId;
    }

    async updateUploadSession(sessionId, updates) {
        const allowedFields = ['collected_files', 'raw_caption', 'session_status'];
        const updateFields = [];
        const values = [];

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                if (key === 'collected_files' && typeof updates[key] === 'object') {
                    values.push(JSON.stringify(updates[key]));
                } else {
                    values.push(updates[key]);
                }
            }
        });

        if (updateFields.length === 0) return null;

        values.push(sessionId);
        const query = `UPDATE media_upload_sessions SET ${updateFields.join(', ')} WHERE id = ?`;
        const [result] = await this.pool.execute(query, values);
        return result;
    }

    async getUploadSession(sessionId) {
        const query = 'SELECT * FROM media_upload_sessions WHERE id = ?';
        const [rows] = await this.pool.execute(query, [sessionId]);
        
        if (rows[0] && rows[0].collected_files) {
            try {
                rows[0].collected_files = JSON.parse(rows[0].collected_files);
            } catch (e) {
                rows[0].collected_files = {};
            }
        }
        
        return rows[0] || null;
    }

    async createMediaContent(contentData) {
        const {
            channel_id, user_id, video_file_id, image_file_id,
            base_price_idr, caption, raw_caption, video_duration
        } = contentData;

        const query = `
            INSERT INTO media_content 
            (channel_id, user_id, video_file_id, image_file_id, base_price_idr, caption, raw_caption, video_duration, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        
        const [result] = await this.pool.execute(query, [
            channel_id, user_id, video_file_id, image_file_id, base_price_idr, caption, raw_caption, video_duration || 0
        ]);
        return result.insertId;
    }

    async getChannelMedia(channelId, limit = 50, offset = 0) {
        const query = `
            SELECT * FROM media_content 
            WHERE channel_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        
        const [rows] = await this.pool.execute(query, [channelId, limit, offset]);
        return rows;
    }

    // Promo management
    async createChannelPromo(promoData) {
        const {
            channel_id, promo_type, discount_percentage, bonus_min_topup, 
            bonus_percentage, expires_at, max_uses_per_user, total_max_uses
        } = promoData;

        const query = `
            INSERT INTO channel_promos 
            (channel_id, promo_type, discount_percentage, bonus_min_topup, bonus_percentage, 
             expires_at, max_uses_per_user, total_max_uses, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        
        const [result] = await this.pool.execute(query, [
            channel_id, promo_type, discount_percentage || 0, bonus_min_topup || 0, 
            bonus_percentage || 0, expires_at, max_uses_per_user, total_max_uses
        ]);
        return result.insertId;
    }

    async getChannelPromos(channelId, activeOnly = false) {
        let query = `
            SELECT * FROM channel_promos 
            WHERE channel_id = ?
        `;
        
        if (activeOnly) {
            query += ` AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`;
        }
        
        query += ` ORDER BY created_at DESC`;
        
        const [rows] = await this.pool.execute(query, [channelId]);
        return rows;
    }

    async updatePromoStatus(promoId, isActive) {
        const query = `UPDATE channel_promos SET is_active = ?, updated_at = NOW() WHERE id = ?`;
        const [result] = await this.pool.execute(query, [isActive, promoId]);
        return result;
    }

    async getActiveDiscountForChannel(channelId) {
        const query = `
            SELECT * FROM channel_promos 
            WHERE channel_id = ? AND promo_type = 'discount' AND is_active = TRUE 
            AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at DESC LIMIT 1
        `;
        
        const [rows] = await this.pool.execute(query, [channelId]);
        return rows[0] || null;
    }

    async getActiveTopupBonusForChannel(channelId) {
        const query = `
            SELECT * FROM channel_promos 
            WHERE channel_id = ? AND promo_type = 'topup_bonus' AND is_active = TRUE 
            AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at DESC LIMIT 1
        `;
        
        const [rows] = await this.pool.execute(query, [channelId]);
        return rows[0] || null;
    }

    // User balance management
    async createOrUpdateUserBalance(userId, channelId, balanceChange = 0, isTopup = false) {
        const query = `
            INSERT INTO user_channel_balances (user_id, channel_id, balance_amount, total_topup, last_topup_at)
            VALUES (?, ?, ?, ?, ${isTopup ? 'NOW()' : 'NULL'})
            ON DUPLICATE KEY UPDATE 
                balance_amount = balance_amount + VALUES(balance_amount),
                total_topup = total_topup + ${isTopup ? 'VALUES(balance_amount)' : '0'},
                last_topup_at = ${isTopup ? 'NOW()' : 'last_topup_at'},
                updated_at = NOW()
        `;
        
        const [result] = await this.pool.execute(query, [userId, channelId, balanceChange, isTopup ? balanceChange : 0]);
        return result;
    }

    async getUserBalance(userId, channelId) {
        const query = `
            SELECT * FROM user_channel_balances 
            WHERE user_id = ? AND channel_id = ?
        `;
        
        const [rows] = await this.pool.execute(query, [userId, channelId]);
        return rows[0] || null;
    }

    async getUserAllBalances(userId) {
        const query = `
            SELECT ucb.*, c.channel_username, c.channel_title 
            FROM user_channel_balances ucb
            JOIN channels c ON ucb.channel_id = c.id
            WHERE ucb.user_id = ? AND c.is_active = TRUE
            ORDER BY ucb.updated_at DESC
        `;
        
        const [rows] = await this.pool.execute(query, [userId]);
        return rows;
    }

    // Activity logging
    async logActivity(userId, channelId, activityType, description, metadata = {}) {
        const query = `
            INSERT INTO activity_logs (user_id, channel_id, activity_type, description, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
        
        const [result] = await this.pool.execute(query, [
            userId, channelId, activityType, description, JSON.stringify(metadata)
        ]);
        return result.insertId;
    }

    // Cleanup expired sessions
    async cleanupExpiredSessions() {
        const query = 'DELETE FROM media_upload_sessions WHERE expires_at < NOW()';
        const [result] = await this.pool.execute(query);
        return result.affectedRows;
    }

    // Get channel by ID
    async getChannelById(channelId) {
        const query = `
            SELECT c.*, u.username, u.first_name, u.last_name
            FROM channels c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = ?
        `;
        
        const [rows] = await this.pool.execute(query, [channelId]);
        
        if (rows.length === 0) {
            return null;
        }
        
        const channel = rows[0];
        
        // Decrypt API key if exists
        if (channel.oy_api_key) {
            try {
                channel.api_key = this.decrypt(channel.oy_api_key);
            } catch (error) {
                console.error('Failed to decrypt API key for channel:', channelId, error);
                channel.api_key = null;
            }
        } else {
            channel.api_key = null;
        }
        
        return channel;
    }

    // Update channel API key
    async updateChannelApiKey(channelId, apiKey) {
        console.log(`🔄 Updating API key for channel ${channelId}`);
        
        const encryptedApiKey = this.encrypt(apiKey);
        
        const query = `
            UPDATE channels 
            SET oy_api_key = ?, updated_at = NOW()
            WHERE id = ?
        `;
        
        const [result] = await this.pool.execute(query, [encryptedApiKey, channelId]);
        
        if (result.affectedRows === 0) {
            throw new Error(`No channel found with ID ${channelId}`);
        }
        
        console.log(`✅ API key updated successfully for channel ${channelId}`);
        return true;
    }

    // Delete channel and all related data
    async deleteChannel(channelId) {
        console.log(`🗑️ Deleting channel ${channelId} and all related data`);
        
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Delete in order to respect foreign key constraints
            // 1. Delete media upload sessions
            await connection.execute(
                'DELETE FROM media_upload_sessions WHERE channel_id = ?', 
                [channelId]
            );
            
            // 2. Delete uploaded content  
            await connection.execute(
                'DELETE FROM media_content WHERE channel_id = ?', 
                [channelId]
            );
            
            // 3. Delete activity logs
            await connection.execute(
                'DELETE FROM activity_logs WHERE channel_id = ?', 
                [channelId]
            );
            
            // 4. Finally delete the channel
            const [result] = await connection.execute(
                'DELETE FROM channels WHERE id = ?', 
                [channelId]
            );
            
            if (result.affectedRows === 0) {
                throw new Error(`No channel found with ID ${channelId}`);
            }
            
            await connection.commit();
            console.log(`✅ Channel ${channelId} and all related data deleted successfully`);
            
        } catch (error) {
            await connection.rollback();
            console.error(`❌ Failed to delete channel ${channelId}:`, error);
            throw error;
        } finally {
            connection.release();
        }
        
        return true;
    }

    // --- Content Methods for Consumer Features ---
    async getContentById(contentId) {
        try {
            const query = `
                SELECT mc.*, c.channel_username, c.channel_title, c.user_id as creator_id,
                       u.username as creator_username, u.first_name as creator_name
                FROM media_content mc
                JOIN channels c ON mc.channel_id = c.id
                JOIN users u ON c.user_id = u.id
                WHERE mc.id = ?
            `;
            
            const [rows] = await this.pool.execute(query, [contentId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting content by ID:', error);
            return null;
        }
    }

    async getChannelContents(channelId, limit = 20, offset = 0) {
        try {
            const query = `
                SELECT * FROM media_content 
                WHERE channel_id = ? AND post_status = 'published'
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `;
            
            const [rows] = await this.pool.execute(query, [channelId, limit, offset]);
            return rows;
            return rows;
        } catch (error) {
            console.error('Error getting channel contents:', error);
            return [];
        }
    }

    async updateMediaContent(contentId, updateData) {
        try {
            const updateFields = [];
            const values = [];
            
            // Build dynamic update query
            for (const [key, value] of Object.entries(updateData)) {
                if (value !== undefined) {
                    updateFields.push(`${key} = ?`);
                    values.push(value);
                }
            }
            
            if (updateFields.length === 0) {
                return false;
            }
            
            values.push(contentId);
            
            const query = `UPDATE media_content SET ${updateFields.join(', ')} WHERE id = ?`;
            const [result] = await this.pool.execute(query, values);
            
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error updating media content:', error);
            return false;
        }
    }

    // Payment and QRIS methods
    async getContentById(contentId) {
        try {
            const query = `
                SELECT mc.*, c.user_id as channel_owner_id, c.channel_title, c.channel_username
                FROM media_content mc 
                JOIN channels c ON mc.channel_id = c.id 
                WHERE mc.id = ?
            `;
            const [rows] = await this.pool.execute(query, [contentId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting content by ID:', error);
            return null;
        }
    }

    async getChannelById(channelId) {
        try {
            const query = 'SELECT * FROM channels WHERE id = ?';
            const [rows] = await this.pool.execute(query, [channelId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting channel by ID:', error);
            return null;
        }
    }

    async getUserById(userId) {
        try {
            const query = 'SELECT * FROM users WHERE id = ?';
            const [rows] = await this.pool.execute(query, [userId]);
            if (rows[0] && rows[0].oy_api_key) {
                rows[0].oy_api_key = this.decrypt(rows[0].oy_api_key);
            }
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting user by ID:', error);
            return null;
        }
    }

    async getChannelsWithPaymentGateway() {
        try {
            const query = `
                SELECT c.*, u.oy_api_key 
                FROM channels c 
                JOIN users u ON c.user_id = u.id 
                WHERE u.oy_api_key IS NOT NULL AND u.oy_api_key != ''
            `;
            const [rows] = await this.pool.execute(query);
            return rows.map(row => {
                if (row.oy_api_key) {
                    row.oy_api_key = this.decrypt(row.oy_api_key);
                }
                return row;
            });
        } catch (error) {
            console.error('Error getting channels with payment gateway:', error);
            return [];
        }
    }

    async savePaymentTransaction(data) {
        try {
            const query = `
                INSERT INTO payment_transactions 
                (external_id, user_id, content_id, channel_id, amount, purpose, payment_method, status, expires_at, qris_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            
            const [result] = await this.pool.execute(query, [
                data.external_id,
                data.user_id,
                data.content_id,
                data.channel_id,
                data.amount,
                data.purpose,
                data.payment_method,
                data.status,
                data.expires_at,
                data.qris_url
            ]);
            
            return result.insertId;
        } catch (error) {
            console.error('Error saving payment transaction:', error);
            throw error;
        }
    }

    async getPaymentTransactionByExternalId(externalId) {
        try {
            const query = 'SELECT * FROM payment_transactions WHERE external_id = ?';
            const [rows] = await this.pool.execute(query, [externalId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting payment transaction:', error);
            return null;
        }
    }

    async updatePaymentTransactionStatus(externalId, status) {
        try {
            const query = 'UPDATE payment_transactions SET status = ?, updated_at = NOW() WHERE external_id = ?';
            const [result] = await this.pool.execute(query, [status, externalId]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error updating payment transaction status:', error);
            return false;
        }
    }

    async getUserChannelBalance(userId, channelId) {
        try {
            const query = `
                SELECT balance_amount 
                FROM user_channel_balances 
                WHERE user_id = ? AND channel_id = ?
            `;
            const [rows] = await this.pool.execute(query, [userId, channelId]);
            return rows[0] ? parseFloat(rows[0].balance_amount) : 0;
        } catch (error) {
            console.error('Error getting user channel balance:', error);
            return 0;
        }
    }

    async addUserChannelBalance(userId, channelId, amount) {
        try {
            const query = `
                INSERT INTO user_channel_balances (user_id, channel_id, balance_amount, total_topup, updated_at) 
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE 
                    balance_amount = balance_amount + VALUES(balance_amount),
                    total_topup = total_topup + VALUES(total_topup),
                    updated_at = NOW()
            `;
            const [result] = await this.pool.execute(query, [userId, channelId, amount, amount]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error adding user channel balance:', error);
            return false;
        }
    }

    async deductUserChannelBalance(userId, channelId, amount) {
        try {
            const query = `
                UPDATE user_channel_balances 
                SET balance_amount = balance_amount - ?, 
                    total_spent = total_spent + ?,
                    updated_at = NOW() 
                WHERE user_id = ? AND channel_id = ? AND balance_amount >= ?
            `;
            const [result] = await this.pool.execute(query, [amount, amount, userId, channelId, amount]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error deducting user channel balance:', error);
            return false;
        }
    }

    async checkUserContentAccess(userId, contentId) {
        try {
            const query = `
                SELECT id 
                FROM content_purchases 
                WHERE user_id = ? AND content_id = ? AND status = 'completed'
            `;
            const [rows] = await this.pool.execute(query, [userId, contentId]);
            return rows.length > 0;
        } catch (error) {
            console.error('Error checking user content access:', error);
            return false;
        }
    }

    async grantContentAccess(userId, contentId, amount) {
        try {
            const query = `
                INSERT INTO content_purchases (user_id, content_id, amount, status, purchased_at)
                VALUES (?, ?, ?, 'completed', NOW())
                ON DUPLICATE KEY UPDATE 
                    status = 'completed',
                    purchased_at = NOW()
            `;
            const [result] = await this.pool.execute(query, [userId, contentId, amount]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error granting content access:', error);
            return false;
        }
    }

    async recordPurchaseTransaction(userId, contentId, amount, paymentMethod) {
        try {
            const query = `
                INSERT INTO purchase_history (user_id, content_id, amount, payment_method, created_at)
                VALUES (?, ?, ?, ?, NOW())
            `;
            const [result] = await this.pool.execute(query, [userId, contentId, amount, paymentMethod]);
            return result.insertId;
        } catch (error) {
            console.error('Error recording purchase transaction:', error);
            return null;
        }
    }

    // Close connection
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('Database connection closed');
        }
    }
}

module.exports = Database;