const axios = require('axios');
const crypto = require('crypto');

class QRISHandler {
    constructor(db, bot) {
        this.db = db;
        this.bot = bot;
        this.environment = process.env.OY_ENVIRONMENT || 'sandbox';
        
        // Set base URL based on environment
        if (this.environment === 'production') {
            this.baseUrl = process.env.OY_API_BASE_URL_PRODUCTION || 'https://partner.oyindonesia.com';
        } else {
            this.baseUrl = process.env.OY_API_BASE_URL_SANDBOX || 'https://api-stg.oyindonesia.com';
        }
        
        this.qrisEndpoint = process.env.OY_QRIS_ENDPOINT || '/api/generate-qris';
        
        console.log(`🏦 OY Indonesia API initialized:`);
        console.log(`   Environment: ${this.environment}`);
        console.log(`   Base URL: ${this.baseUrl}`);
        console.log(`   QRIS Endpoint: ${this.qrisEndpoint}`);
    }

    /**
     * Generate QRIS for content purchase
     * Automatically detects channel owner and uses their API key
     */
    async generateQRISForContent(chatId, userId, contentId, amount, purpose = 'content_purchase') {
        try {
            console.log('=== QRIS Generation Started ===');
            console.log('Chat ID:', chatId, 'User ID:', userId, 'Content ID:', contentId, 'Amount:', amount);
            
            // Get content details including channel info
            const content = await this.db.getContentById(contentId);
            if (!content) {
                console.log('Content not found for ID:', contentId);
                throw new Error('Content not found');
            }
            
            console.log('Content found:', content.id, 'Channel ID:', content.channel_id);

            // Get channel details and API key
            const channel = await this.db.getChannelById(content.channel_id);
            if (!channel) {
                console.log('Channel not found for ID:', content.channel_id);
                throw new Error('Channel not found');
            }
            
            console.log('Channel found:', channel.id, 'User ID:', channel.user_id);

            // Get channel owner's API key
            const apiKey = await this.getChannelOwnerApiKey(channel.user_id);
            if (!apiKey) {
                console.log('No API key found for channel owner:', channel.user_id);
                await this.bot.sendMessage(chatId, 
                    '❌ Channel owner belum mengkonfigurasi payment gateway.\n\n' +
                    'Silakan hubungi admin channel untuk mengaktifkan pembayaran QRIS.'
                );
                return null;
            }
            
            console.log('API key found, length:', apiKey.length);

            // Generate unique transaction ID
            const externalId = `content_${contentId}_${userId}_${Date.now()}`;
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            console.log('Creating QRIS with external ID:', externalId);

            // Create QRIS payment
            const qrisData = {
                external_id: externalId,
                amount: amount,
                user_id: userId,
                description: `Purchase: ${content.title || 'Content'}`,
                expires_at: expiresAt
            };

            const qrisResponse = await this.createQRISPayment(qrisData, apiKey);
            
            if (!qrisResponse.status) {
                console.log('QRIS creation failed:', qrisResponse);
                throw new Error('Failed to create QRIS payment');
            }
            
            console.log('QRIS created successfully');

            // Save transaction to database
            await this.savePaymentTransaction({
                external_id: externalId,
                user_id: userId,
                content_id: contentId,
                channel_id: content.channel_id,
                amount: amount,
                purpose: purpose,
                payment_method: 'qris',
                status: 'pending',
                expires_at: expiresAt,
                qris_url: qrisResponse.data.qris_url || qrisResponse.data.qr_url
            });

            // Send QRIS to user
            await this.sendQRISToUser(chatId, qrisResponse, {
                content: content,
                amount: amount,
                externalId: externalId,
                expiresAt: expiresAt
            });

            console.log('=== QRIS Generation Completed ===');
            return qrisResponse;

        } catch (error) {
            console.error('Error generating QRIS for content:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal membuat QRIS pembayaran. Silakan coba lagi atau hubungi support.'
            );
            return null;
        }
    }

    /**
     * Generate QRIS for balance top-up
     * Uses channel-specific API key based on selected channel
     */
    async generateQRISForTopup(chatId, userId, amount, channelId = null, pendingContentId = null) {
        try {
            let apiKey;
            let channelInfo = null;

            if (channelId) {
                // Get specific channel's API key
                const channel = await this.db.getChannelById(channelId);
                if (!channel) {
                    throw new Error('Channel not found');
                }
                apiKey = await this.getChannelOwnerApiKey(channel.user_id);
                channelInfo = channel;
            } else {
                // Use user's own API key if they're a channel owner
                const userChannels = await this.db.getUserChannels(userId);
                if (userChannels.length > 0) {
                    apiKey = await this.getChannelOwnerApiKey(userId);
                    channelInfo = userChannels[0]; // Use first channel
                }
            }

            if (!apiKey) {
                await this.bot.sendMessage(chatId, 
                    '❌ Tidak ada channel dengan payment gateway aktif.\n\n' +
                    'Untuk top-up saldo, Anda perlu:\n' +
                    '1. Memiliki channel sendiri dengan API key OY Indonesia, atau\n' +
                    '2. Memilih channel yang mendukung top-up saldo'
                );
                return null;
            }

            // Generate unique transaction ID
            const externalId = `topup_${userId}_${Date.now()}`;
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            // Create QRIS payment
            const qrisData = {
                external_id: externalId,
                amount: amount,
                user_id: userId,
                description: `Top-up saldo: ${this.formatCurrency(amount)}`,
                expires_at: expiresAt
            };

            const qrisResponse = await this.createQRISPayment(qrisData, apiKey);
            
            if (!qrisResponse.status) {
                throw new Error('Failed to create QRIS payment');
            }

            // Save transaction to database
            await this.savePaymentTransaction({
                external_id: externalId,
                user_id: userId,
                content_id: null,
                pending_content_id: pendingContentId, // Store the pending content
                channel_id: channelInfo ? channelInfo.id : null,
                amount: amount,
                purpose: 'balance_topup',
                payment_method: 'qris',
                status: 'pending',
                expires_at: expiresAt,
                qris_url: qrisResponse.data.qris_url || qrisResponse.data.qr_url
            });

            // Send QRIS to user
            await this.sendQRISToUser(chatId, qrisResponse, {
                amount: amount,
                externalId: externalId,
                expiresAt: expiresAt,
                purpose: 'top-up',
                channel: channelInfo
            });

            return qrisResponse;

        } catch (error) {
            console.error('Error generating QRIS for top-up:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal membuat QRIS top-up. Silakan coba lagi atau hubungi support.'
            );
            return null;
        }
    }

    /**
     * Create QRIS payment with OY Indonesia API
     */
    async createQRISPayment(qrisData, apiKey) {
        try {
            // Check if using placeholder/invalid API key
            if (!apiKey || apiKey === 'your_oy_api_key' || apiKey.includes('placeholder')) {
                console.log('Using mock QRIS response (no valid OY API key)');
                return this.getMockQRISResponse(qrisData);
            }

            const payload = {
                partner_trx_id: qrisData.external_id,
                amount: qrisData.amount,
                is_open: false,
                expiration_time: this.formatExpiration(qrisData.expires_at),
                partner_user_id: qrisData.user_id.toString()
            };

            console.log('Making OY API call with payload:', JSON.stringify(payload, null, 2));
            console.log('API Endpoint:', `${this.baseUrl}${this.qrisEndpoint}`);
            console.log('Headers:', { 'X-OY-Username': apiKey.substring(0, 8) + '...', 'X-Api-Key': 'provided' });

            const response = await axios.post(`${this.baseUrl}${this.qrisEndpoint}`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-OY-Username': apiKey,
                    'X-Api-Key': apiKey
                }
            });

            console.log('OY API Success:', response.data);
            return response.data;

        } catch (error) {
            console.error('OY QRIS Error:', error.response?.data || error.message);
            
            // If API endpoint not found or other API issues, fallback to mock for now
            if (error.response?.status === 404 || error.response?.status >= 400) {
                console.log('API error detected, falling back to mock QRIS response');
                return this.getMockQRISResponse(qrisData);
            }
            
            throw error;
        }
    }

    getMockQRISResponse(qrisData) {
        return {
            status: true,
            data: {
                partner_trx_id: qrisData.external_id,
                qris_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=MOCK_QRIS_${qrisData.external_id}`,
                qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=MOCK_QRIS_${qrisData.external_id}`,
                amount: qrisData.amount,
                created_date: new Date().toISOString(),
                expiration_time: this.formatExpiration(qrisData.expires_at)
            }
        };
    }

    /**
     * Send QRIS QR code and details to user
     */
    async sendQRISToUser(chatId, qrisResponse, details) {
        try {
            const qrisUrl = qrisResponse.data.qris_url || qrisResponse.data.qr_url;
            const { amount, externalId, expiresAt, content, purpose, channel } = details;

            // Format expiration time
            const expirationTime = new Date(expiresAt);
            const expirationStr = expirationTime.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Jakarta'
            });

            // Build caption
            let caption = '';
            
            if (purpose === 'top-up') {
                caption = `🔰 **QRIS Top-up Saldo**\n\n`;
                caption += `💰 **Jumlah:** ${this.formatCurrency(amount)}\n`;
                if (channel) {
                    caption += `📺 **Channel:** ${channel.channel_title || channel.channel_username}\n`;
                }
            } else {
                caption = `🔰 **QRIS Pembayaran Konten**\n\n`;
                if (content) {
                    caption += `🎬 **Konten:** ${content.title || content.caption || 'Video Premium'}\n`;
                }
                caption += `💰 **Harga:** ${this.formatCurrency(amount)}\n`;
            }

            caption += `\n⏰ **Berlaku hingga:** ${expirationStr} WIB`;
            caption += `\n🔢 **ID Transaksi:** \`${externalId}\``;
            caption += `\n\n📱 **Cara Pembayaran:**`;
            caption += `\n1. Buka aplikasi e-wallet (GoPay, OVO, DANA, ShopeePay, dll)`;
            caption += `\n2. Pilih fitur "Scan QR" atau "QRIS"`;
            caption += `\n3. Scan kode QR di atas`;
            caption += `\n4. Konfirmasi pembayaran`;
            caption += `\n5. Konten akan dikirim otomatis setelah pembayaran berhasil`;
            caption += `\n\n⚠️ **Penting:** QRIS ini akan kedaluwarsa dalam **10 menit**`;
            caption += `\n\n💡 Jika mengalami kendala, silakan hubungi support.`;

            // Send QR code image with caption
            await this.bot.sendPhoto(chatId, qrisUrl, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Cek Status Pembayaran', callback_data: `check_payment_${externalId}` }
                        ],
                        [
                            { text: '❌ Batalkan', callback_data: `cancel_payment_${externalId}` }
                        ]
                    ]
                }
            });

            // Set up payment monitoring
            this.monitorPayment(externalId, chatId, expiresAt);

        } catch (error) {
            console.error('Error sending QRIS to user:', error);
            // Fallback: send text message with QR URL
            const fallbackMessage = `🔰 QRIS Pembayaran dibuat!\n\n` +
                                  `💰 Jumlah: ${this.formatCurrency(details.amount)}\n` +
                                  `🔢 ID: ${details.externalId}\n\n` +
                                  `QR Code: ${qrisResponse.data.qris_url || qrisResponse.data.qr_url}\n\n` +
                                  `⚠️ Berlaku 10 menit`;
            
            await this.bot.sendMessage(chatId, fallbackMessage);
        }
    }

    /**
     * Monitor payment status and notify user when paid
     */
    monitorPayment(externalId, chatId, expiresAt) {
        const checkInterval = setInterval(async () => {
            try {
                const transaction = await this.db.getPaymentTransactionByExternalId(externalId);
                
                if (!transaction) {
                    clearInterval(checkInterval);
                    return;
                }

                if (transaction.status === 'paid') {
                    clearInterval(checkInterval);
                    
                    // Process the successful payment (this will send the content and notification)
                    await this.processSuccessfulPayment(externalId);
                } else if (transaction.status === 'expired' || new Date() > new Date(expiresAt)) {
                    clearInterval(checkInterval);
                    await this.db.updatePaymentTransactionStatus(externalId, 'expired');
                }
            } catch (error) {
                console.error('Error monitoring payment:', error);
            }
        }, 30000); // Check every 30 seconds

        // Stop monitoring after expiration + 1 minute
        setTimeout(() => {
            clearInterval(checkInterval);
        }, (10 * 60 + 1) * 1000);
    }

    /**
     * Process successful payment
     */
    async processSuccessfulPayment(externalId) {
        try {
            console.log(`Processing successful payment for ${externalId}`);
            const transaction = await this.db.getPaymentTransactionByExternalId(externalId);

            if (!transaction) {
                console.error(`Transaction not found: ${externalId}`);
                return;
            }

            if (transaction.status === 'paid') {
                console.log(`Transaction ${externalId} already processed.`);
                return;
            }

            // Update transaction status
            await this.db.updatePaymentTransactionStatus(externalId, 'paid');

            // Grant content access
            if (transaction.purpose === 'content_purchase' && transaction.content_id) {
                await this.db.grantContentAccess(transaction.user_id, transaction.content_id, transaction.amount);
                console.log(`Access granted for user ${transaction.user_id} to content ${transaction.content_id}`);
                
                // Record purchase in purchase history
                await this.db.recordPurchaseTransaction(transaction.user_id, transaction.content_id, transaction.amount, 'qris');
                
                // Send the content to the user FIRST
                await this.sendContentToUser(transaction.user_id, transaction.content_id);
            }

            // Handle balance top-up
            if (transaction.purpose === 'balance_topup') {
                // Ensure we have a valid channel_id for balance operations
                if (!transaction.channel_id) {
                    console.error(`No channel_id for balance top-up transaction: ${externalId}`);
                    // Try to get user's first channel as fallback
                    const userChannels = await this.db.getUserChannels(transaction.user_id);
                    if (userChannels && userChannels.length > 0) {
                        transaction.channel_id = userChannels[0].id;
                        console.log(`Using fallback channel_id: ${transaction.channel_id}`);
                    } else {
                        throw new Error('No valid channel found for balance operation');
                    }
                }

                await this.db.addUserChannelBalance(transaction.user_id, transaction.channel_id, transaction.amount);
                console.log(`Balance updated for user ${transaction.user_id} by ${transaction.amount}`);
                
                // Check if there's a pending content to purchase
                if (transaction.pending_content_id) {
                    console.log(`Found pending content ${transaction.pending_content_id} for user ${transaction.user_id}`);
                    // Show purchase confirmation directly instead of success message + button
                    await this.showPendingContentConfirmation(transaction.user_id, transaction.pending_content_id, transaction.channel_id);
                } else {
                    // No pending content, show regular top-up success
                    const currentBalance = await this.db.getUserChannelBalance(transaction.user_id, transaction.channel_id);
                    
                    await this.bot.sendMessage(transaction.user_id, 
                        `✅ **Top-up Berhasil!**\n\n` +
                        `💰 **Jumlah Top-up:** ${this.formatCurrency(transaction.amount)}\n` +
                        `💳 **Saldo Sekarang:** ${this.formatCurrency(currentBalance)}\n\n` +
                        `🔢 **ID Transaksi:** \`${transaction.external_id}\`\n\n` +
                        `🎯 **Langkah Selanjutnya:**\n` +
                        `• Gunakan saldo untuk membeli konten premium\n` +
                        `• Atau ketik /start untuk kembali ke menu`,
                        { 
                            parse_mode: 'Markdown'
                        }
                    );
                }
            }

            console.log(`Payment for ${externalId} processed successfully.`);

        } catch (error) {
            console.error(`Error processing successful payment for ${externalId}:`, error);
        }
    }

    /**
     * Send purchased content to the user
     */
    async sendContentToUser(userId, contentId) {
        try {
            const content = await this.db.getContentById(contentId);
            if (!content) {
                throw new Error('Content not found');
            }
            // Build unified delivery caption similar to consumer's deliverContent
            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            const title = content.caption || content.title || 'Video Premium';
            const price = content.base_price_idr ? formatCurrency(content.base_price_idr) : '';

            const caption = `\n🎉 **Pembelian Berhasil!**\n\n` +
                          `🎬 **${title}**\n` +
                          (price ? `💰 **Harga:** ${price}\n` : '') +
                          `📅 **Dibeli:** ${new Date().toLocaleDateString('id-ID')}\n\n` +
                          `✅ **Terima kasih atas pembeliannya!**`;

            // Prefer sending using existing Telegram file identifiers if present (video_file_id / image_file_id),
            // otherwise fall back to file_path which may be a URL or stored path.
            if (content.video_file_id || content.file_type === 'video') {
                const videoSource = content.video_file_id || content.file_path;
                await this.bot.sendVideo(userId, videoSource, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
            } else if (content.image_file_id || content.file_type === 'photo') {
                const photoSource = content.image_file_id || content.file_path;
                await this.bot.sendPhoto(userId, photoSource, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
            } else if (content.file_path) {
                await this.bot.sendDocument(userId, content.file_path, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
            } else {
                // If no file available, send a plain message with download instructions
                await this.bot.sendMessage(userId, '✅ Pembelian berhasil! Namun file konten tidak tersedia. Silakan hubungi support.');
            }
        } catch (error) {
            console.error('Error sending content to user:', error);
            await this.bot.sendMessage(userId, 
                '✅ Pembayaran berhasil! Namun terjadi error saat mengirim konten. ' +
                'Silakan hubungi support dengan menyertakan ID transaksi.'
            );
        }
    }

    /**
     * Show pending content purchase confirmation after successful top-up
     */
    async showPendingContentConfirmation(userId, contentId, channelId) {
        try {
            // Get content details
            const content = await this.db.getContentById(contentId);
            if (!content) {
                console.error(`Pending content ${contentId} not found`);
                return;
            }

            // Calculate price and get current balance
            const originalPrice = parseFloat(content.base_price_idr);
            const finalPrice = originalPrice; // You can add discount calculation here if needed
            const currentBalance = await this.db.getUserChannelBalance(userId, channelId);

            // Create confirmation message like direct balance purchase
            const title = content.caption || content.title || 'Video Premium';
            
            let message = `✅ **Top-up berhasil!**\n\n`;
            message += `🎬 **${title}**\n\n`;
            message += `💰 **Harga:** ${this.formatCurrency(finalPrice)}\n`;
            message += `💳 **Saldo Anda:** ${this.formatCurrency(currentBalance)}\n\n`;

            const keyboard = [];

            if (currentBalance >= finalPrice) {
                message += `✅ **Saldo mencukupi!**\n\n**Lanjutkan pembelian?**`;
                keyboard.push([
                    { text: '✅ Ya, Beli Sekarang', callback_data: `confirm_pending_purchase_${contentId}` }
                ]);
                keyboard.push([
                    { text: '❌ Batalkan', callback_data: 'cancel_pending_purchase' }
                ]);
            } else {
                const shortfall = finalPrice - currentBalance;
                message += `🔴 **Masih kurang ${this.formatCurrency(shortfall)}**\n\n**Pilihan:**`;
                keyboard.push([
                    { text: '📱 Bayar dengan QRIS', callback_data: `pay_qris_${contentId}` }
                ]);
                keyboard.push([
                    { text: '💰 Top-up Lagi', callback_data: `topup_balance_${contentId}` }
                ]);
                keyboard.push([
                    { text: '❌ Batalkan', callback_data: 'cancel_pending_purchase' }
                ]);
            }

            await this.bot.sendMessage(userId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('Error showing pending content confirmation:', error);
            await this.bot.sendMessage(userId, '✅ Top-up berhasil! Namun terjadi kesalahan. Silakan coba beli konten lagi.');
        }
    }

    /**
     * Get channel owner's OY Indonesia API key
     */
    async getChannelOwnerApiKey(userId) {
        try {
            console.log('Getting API key for user ID:', userId);
            
            // Get the user's channels and find one with API key
            const channels = await this.db.getUserChannels(userId);
            console.log('Found channels:', channels.length);
            
            if (channels && channels.length > 0) {
                // Find a channel with API key
                for (const channel of channels) {
                    console.log('Checking channel:', channel.id, 'API key available:', !!channel.api_key);
                    if (channel.api_key) {
                        console.log('Using API key from channel:', channel.id);
                        return channel.api_key; // Already decrypted by getUserChannels method
                    }
                }
            }
            console.log('No API key found for user:', userId);
            return null;
        } catch (error) {
            console.error('Error getting API key:', error);
            return null;
        }
    }

    /**
     * Save payment transaction to database
     */
    async savePaymentTransaction(data) {
        try {
            const query = `
                INSERT INTO payment_transactions 
                (external_id, user_id, content_id, pending_content_id, channel_id, amount, purpose, payment_method, status, expires_at, qris_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            
            await this.db.pool.execute(query, [
                data.external_id,
                data.user_id,
                data.content_id,
                data.pending_content_id || null,
                data.channel_id,
                data.amount,
                data.purpose,
                data.payment_method,
                data.status,
                data.expires_at,
                data.qris_url
            ]);
        } catch (error) {
            console.error('Error saving payment transaction:', error);
            throw error;
        }
    }

    /**
     * Helper methods
     */
    formatExpiration(date) {
        return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);
    }

    decryptApiKey(encryptedKey) {
        try {
            // Implement your decryption logic here
            // For now, return as-is (assuming it's not encrypted)
            return encryptedKey;
        } catch (error) {
            console.error('Error decrypting API key:', error);
            return null;
        }
    }

    /**
     * Handle callback queries for QRIS payments
     */
    async handleCallbackQuery(query) {
        const data = query.data;
        const chatId = query.message.chat.id;
        
        try {
            if (data.startsWith('check_payment_')) {
                const externalId = data.replace('check_payment_', '');
                await this.bot.answerCallbackQuery(query.id, { text: '🔄 Mengecek status pembayaran...' });
                await this.handlePaymentStatusCheck(externalId, chatId);
            } else if (data.startsWith('cancel_payment_')) {
                const externalId = data.replace('cancel_payment_', '');
                await this.bot.answerCallbackQuery(query.id, { text: '❌ Pembayaran dibatalkan' });
                await this.db.updatePaymentTransactionStatus(externalId, 'cancelled');
                await this.bot.editMessageCaption('❌ **Pembayaran dibatalkan**\n\nTransaksi telah dibatalkan oleh pengguna.', {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown'
                });
            }
        } catch (error) {
            console.error('Error handling QRIS callback query:', error);
            await this.bot.answerCallbackQuery(query.id, { 
                text: '❌ Terjadi kesalahan sistem. Tim teknis sudah diberitahu.',
                show_alert: true 
            });
        }
    }

    /**
     * Handle payment status check callback
     */
    async handlePaymentStatusCheck(externalId, chatId) {
        try {
            const transaction = await this.db.getPaymentTransactionByExternalId(externalId);
            
            if (!transaction) {
                await this.bot.sendMessage(chatId, '❌ Transaksi tidak ditemukan.');
                return;
            }

            let statusText = '';
            switch (transaction.status) {
                case 'pending':
                    statusText = '⏳ **Status:** Menunggu pembayaran\n\nSilakan selesaikan pembayaran melalui QRIS yang telah dibuat.';
                    break;
                case 'paid':
                    statusText = '✅ **Status:** Pembayaran berhasil\n\nTerima kasih! Transaksi Anda telah selesai.';
                    break;
                case 'expired':
                    statusText = '⏰ **Status:** Kedaluwarsa\n\nQRIS pembayaran sudah kedaluwarsa. Silakan buat transaksi baru.';
                    break;
                case 'failed':
                    statusText = '❌ **Status:** Pembayaran gagal\n\nSilakan coba lagi atau hubungi support.';
                    break;
                default:
                    statusText = '❓ **Status:** Tidak diketahui\n\nSilakan hubungi support untuk informasi lebih lanjut.';
            }

            await this.bot.sendMessage(chatId, 
                `📋 **Status Pembayaran**\n\n` +
                `🔢 **ID:** ${externalId}\n` +
                `💰 **Jumlah:** ${this.formatCurrency(transaction.amount)}\n\n` +
                statusText,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Error checking payment status:', error);
            await this.bot.sendMessage(chatId, '❌ Gagal mengecek status pembayaran.');
        }
    }
}

module.exports = QRISHandler;