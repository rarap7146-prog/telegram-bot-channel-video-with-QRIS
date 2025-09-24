const { safeHandler } = require('./helpers');

class MainHandlers {
    constructor(bot, db, userSessions, channelSetup, contentManagement, settings, promoManagement, consumerHandlers, qrisHandler) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
        this.channelSetup = channelSetup;
        this.contentManagement = contentManagement;
        this.settings = settings;
        this.promoManagement = promoManagement;
        this.consumerHandlers = consumerHandlers;
        this.qrisHandler = qrisHandler;

        // Bind the safeHandler to the current context
        this.safeHandler = this.safeHandler.bind(this);
    }

    safeHandler(fn) {
        return async (msg, match) => {
            try {
                await fn(msg, match);
            } catch (error) {
                console.error('Unhandled error in handler:', error);
                const chatId = msg.chat?.id || msg.message?.chat?.id;
                if (chatId) {
                    this.bot.sendMessage(chatId, '❌ Terjadi kesalahan tak terduga. Tim kami telah diberitahu. Silakan coba lagi nanti.').catch(err => {
                        console.error('Failed to send error message to user:', err);
                    });
                }
            }
        };
    }

    registerCommands() {
        // Start Command
        this.bot.onText(/\/start/, safeHandler(async (msg) => {
            await this.handleStart(msg);
        }, this.bot));

        // New Simplified Commands
        this.bot.onText(/\/creators/, safeHandler(async (msg) => {
            await this.handleCreatorsMenu(msg);
        }, this.bot));

        this.bot.onText(/\/viewers/, safeHandler(async (msg) => {
            await this.handleViewersMenu(msg);
        }, this.bot));

        // Legacy Commands (still supported for existing users)
        this.bot.onText(/\/setup/, safeHandler(async (msg) => {
            await this.handleSetup(msg);
        }, this.bot));

        this.bot.onText(/\/settings/, safeHandler(async (msg) => {
            await this.handleSettings(msg);
        }, this.bot));

        this.bot.onText(/\/help/, safeHandler(async (msg) => {
            await this.handleHelp(msg);
        }, this.bot));

        this.bot.onText(/\/support/, safeHandler(async (msg) => {
            await this.handleSupport(msg);
        }, this.bot));

        this.bot.onText(/\/donate/, safeHandler(async (msg) => {
            await this.handleDonate(msg);
        }, this.bot));

        this.bot.onText(/\/promo/, safeHandler(async (msg) => {
            await this.handlePromo(msg);
        }, this.bot));

        // Consumer Commands
        this.bot.onText(/\/balance/, safeHandler(async (msg) => {
            await this.consumerHandlers.handleBalance(msg);
        }, this.bot));

        this.bot.onText(/\/topup/, safeHandler(async (msg) => {
            await this.consumerHandlers.handleTopup(msg);
        }, this.bot));

        this.bot.onText(/\/history/, safeHandler(async (msg) => {
            await this.consumerHandlers.handleHistory(msg);
        }, this.bot));

        // Text message handler for setup process
        this.bot.on('message', safeHandler(async (msg) => {
            await this.handleMessage(msg);
        }, this.bot));

        // Callback query handler - centralize via helpers.safeHandler to preserve bot context
        this.bot.on('callback_query', safeHandler(async (query) => {
            await this.handleCallbackQuery(query);
        }, this.bot));

        // Command to simulate a successful QRIS payment
        this.bot.onText(/\/test_qris_payment (.+)/, safeHandler(async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const transactionId = match[1];

            // Check if the user is an admin
            const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim(), 10));
            if (!adminIds.includes(userId)) {
                return this.bot.sendMessage(chatId, '❌ Anda tidak memiliki izin untuk menggunakan perintah ini.');
            }

            if (!transactionId) {
                return this.bot.sendMessage(chatId, '⚠️ Silakan berikan ID transaksi. Contoh: `/test_qris_payment <transaction_id>`');
            }

            try {
                console.log(`Simulated successful payment for ${transactionId} by admin ${userId}`);
                
                // Manually trigger the payment processing
                await this.qrisHandler.processSuccessfulPayment(transactionId);

                await this.bot.sendMessage(chatId, `✅ Simulasi pembayaran untuk transaksi \`${transactionId}\` berhasil diproses.`);

            } catch (error) {
                console.error(`Error simulating payment for ${transactionId}:`, error);
                await this.bot.sendMessage(chatId, `❌ Gagal mensimulasikan pembayaran untuk transaksi ${transactionId}.`);
            }
        }));

        // Note: callback_query handling logic is implemented inside `handleCallbackQuery`
        // and invoked above via the single registration using helpers.safeHandler.
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;
        
        // Check if this is a deep link for content purchase
        const deepLinkMatch = text.match(/\/start content_(\d+)/);
        if (deepLinkMatch) {
            // This is a consumer trying to purchase content
            return await this.consumerHandlers.handleStart(msg);
        }
        
        // Ensure user exists in database
        await this.db.createOrUpdateUser({
            id: userId,
            username: msg.from.username,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name
        });
        
        await this.db.logActivity(userId, null, 'start', 'User started bot');

        // Show general welcome message with clear options
        const welcomeMessage = `
🎬 **Selamat Datang di PapaBadak Creator Bot!**

Halo ${msg.from.first_name}! 👋

Bot ini adalah platform hybrid yang melayani:

🎨 **CREATOR** - Mengelola channel konten premium
• Upload video dengan thumbnail
• Atur harga dan promosi  
• Kelola pembayaran otomatis
• Analisis performa channel

🛒 **VIEWER** - Beli konten premium dari creator
• Browse konten dari berbagai channel
• Top-up saldo per channel
• Riwayat pembelian
• Akses konten yang sudah dibeli

**Pilih peran Anda:**
        `;

        await this.bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎨 Saya Creator', callback_data: 'role_creator' },
                        { text: '🛒 Saya Viewer', callback_data: 'role_viewer' }
                    ],
                    [
                        { text: '📚 Panduan Lengkap', callback_data: 'show_help' },
                        { text: '🎯 Support', callback_data: 'contact_support' }
                    ]
                ]
            }
        });
    }

    async handleCreatorsMenu(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Get user's channels
        const userChannels = await this.db.getUserChannels(userId);

        // Build channel list safely to avoid Markdown issues
        let channelList = '';
        if (userChannels.length > 0) {
            channelList = '**Channel Anda:**\n';
            channelList += userChannels.map(channel => {
                const channelName = channel.channel_title || channel.channel_username || 'Unknown Channel';
                const contentCount = channel.total_content || 0;
                // Escape potential Markdown characters in channel names
                const safeName = channelName.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
                return `• ${safeName} (${contentCount} konten)`;
            }).join('\n');
        } else {
            channelList = '**Belum ada channel terdaftar**\nMulai dengan menambahkan channel pertama Anda!';
        }

        const creatorMenu = `
🎨 **CREATOR DASHBOARD**

${channelList}

**Menu Creator:**
        `;

        const keyboard = [];
        
        // Main creator functions
        keyboard.push([
            { text: '📺 Kelola Channel', callback_data: 'creator_channels' },
            { text: '📤 Upload Konten', callback_data: 'creator_upload' }
        ]);
        
        keyboard.push([
            { text: '🎯 Promosi & Diskon', callback_data: 'creator_promos' },
            { text: '📊 Statistik', callback_data: 'creator_stats' }
        ]);
        
        keyboard.push([
            { text: '⚙️ Pengaturan', callback_data: 'creator_settings' },
            { text: '💳 Pembayaran', callback_data: 'creator_payments' }
        ]);

        if (userChannels.length === 0) {
            keyboard.unshift([
                { text: '🚀 Tambah Channel Pertama', callback_data: 'setup_start' }
            ]);
        }

        await this.bot.sendMessage(chatId, creatorMenu, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async handleViewersMenu(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Get user's balances and purchase history (mock for now)
        const userBalances = await this.getUserChannelBalances(userId);
        const totalPurchases = await this.getUserTotalPurchases(userId);

        // Format currency safely for Markdown
        const totalSaldoFormatted = this.formatCurrencySafe(userBalances.total);
        
        // Build channel balances list safely
        let channelBalancesList = '';
        if (userBalances.channels.length > 0) {
            channelBalancesList = userBalances.channels.map(ch => {
                // Escape channel name to avoid Markdown issues
                const safeChannelName = ch.channel_name.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
                return `${this.formatCurrencySafe(ch.balance)} | ${safeChannelName}`;
            }).join('\n');
        } else {
            channelBalancesList = 'Belum ada saldo di channel manapun';
        }

        const viewerMenu = `
🛒 **VIEWER DASHBOARD**

👤 **Profil Anda:**
📊 Total Pembelian: ${totalPurchases} konten
💰 Total Saldo: ${totalSaldoFormatted}

**Saldo Per Channel:**
${channelBalancesList}

**Menu Viewer:**
        `;

        const keyboard = [
            [
                { text: '🎬 Browse Konten', callback_data: 'viewer_browse' },
                { text: '💳 Kelola Saldo', callback_data: 'viewer_balance' }
            ],
            [
                { text: '📚 Konten Saya', callback_data: 'viewer_library' },
                { text: '📜 Riwayat Beli', callback_data: 'viewer_history' }
            ],
            [
                { text: '🔝 Top-up Saldo', callback_data: 'viewer_topup' },
                { text: '⚙️ Pengaturan', callback_data: 'viewer_settings' }
            ]
        ];

        await this.bot.sendMessage(chatId, viewerMenu, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // Helper methods for viewer data
    async getUserChannelBalances(userId) {
        // Mock implementation - replace with real database queries
        return {
            total: 50000,
            channels: [
                { channel_name: '@test_channel78', balance: 50000 }
            ]
        };
    }

    async getUserTotalPurchases(userId) {
        // Mock implementation - replace with real database queries
        return 0;
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);
    }

    formatCurrencySafe(amount) {
        // Safe currency formatting for Markdown - avoid special characters
        const formatted = new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0
        }).format(amount);
        return `Rp ${formatted}`;
    }

    async showCreatorWelcome(msg) {
        const chatId = msg.chat.id;
        
        const welcomeMessage = `
👋 **Selamat Datang di Bot Creator Papa!**

Bot ini membantu Anda mengelola channel konten dengan sistem pembayaran terintegrasi.

**Fitur Utama:**
🎬 Upload konten dengan harga otomatis
💰 Integrasi pembayaran OY Indonesia  
📊 Management multi-channel
🔒 Sistem keamanan berlapis

**Perintah Yang Tersedia:**
/setup - Setup channel baru
/settings - Pengaturan channel dan pembayaran
/help - Bantuan lengkap

Untuk memulai, silakan gunakan perintah /setup untuk mengonfigurasi channel pertama Anda.
        `;
        
        await this.bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Setup Channel Baru', callback_data: 'setup_start' }],
                    [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }],
                    [{ text: '❓ Bantuan', callback_data: 'help_menu' }]
                ]
            }
        });
    }

    async handleSetup(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        await this.channelSetup.startSetup(chatId, userId);
    }

    async handleSettings(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        await this.settings.showSettingsMenu(chatId, userId);
    }

    async handleHelp(msg) {
        const chatId = msg.chat.id;
        
        await this.showHelpMenu(chatId);
    }

    async handleSupport(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        const TECH_SUPPORT_USERNAME = process.env.TECH_SUPPORT_USERNAME || 'titokt78';
        const TECH_SUPPORT_DISPLAY_NAME = process.env.TECH_SUPPORT_DISPLAY_NAME || 'papabadak';
        
        const supportMessage = `
🆘 **Dukungan Teknis**

Butuh bantuan? Hubungi tim support kami:

👨‍💻 **Tech Support:** @${TECH_SUPPORT_USERNAME} (${TECH_SUPPORT_DISPLAY_NAME})
📧 **User ID Anda:** \`${userId}\`

**Masalah Umum:**
• Setup channel gagal
• Bot tidak bisa posting
• Masalah pembayaran OY Indonesia
• Error saat upload konten

**Tips Cepat:**
✅ Pastikan bot sudah jadi admin di channel
✅ Periksa format caption: #harga#deskripsi
✅ API Key OY Indonesia valid dan aktif

Tim support siap membantu 24/7!
        `;
        
        await this.bot.sendMessage(chatId, supportMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💬 Chat dengan Support', url: `https://t.me/${TECH_SUPPORT_USERNAME}` }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                ]
            }
        });
        
        await this.db.logActivity(userId, null, 'support_request', 'User requested support');
    }

    async handleDonate(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        const donateMessage = `
☕ **Traktir Kopi Buat Admin**

Terima kasih telah menggunakan Bot Creator Papa! 

Jika bot ini membantu bisnis konten Anda, dukung pengembangan dengan memberikan donasi.

💝 **Donasi membantu:**
• Maintenance server dan database
• Pengembangan fitur baru
• Support teknis 24/7
• Update keamanan

Setiap dukungan sangat berarti untuk kami! 🙏
        `;
        
        await this.bot.sendMessage(chatId, donateMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Donasi Sekarang', url: process.env.DONATION_URL || 'https://papabadak.carrd.co/' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                ]
            }
        });
        
        await this.db.logActivity(userId, null, 'donation_view', 'User viewed donation page');
    }

    async handlePromo(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        await this.promoManagement.showPromoMenu(chatId, userId);
    }

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;
        
        // Skip commands
        if (text?.startsWith('/')) return;
        
        // Handle media uploads
        if (!text && (msg.video || msg.photo || msg.document)) {
            // Check if user has any channels set up
            const userChannels = await this.db.getUserChannels(userId);
            if (userChannels.length === 0) {
                await this.bot.sendMessage(chatId, 
                    '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
                    'Silakan gunakan /setup untuk mendaftarkan channel Anda terlebih dahulu.'
                );
                return;
            }
            
            // Handle media upload
            await this.contentManagement.handleMediaUpload(msg, userChannels[0]); // Use first channel for now
            return;
        }
        
        // Handle text input for various processes
        const session = this.userSessions.get(userId);
        if (!session) return;
        
        switch (session.step) {
            case 'awaiting_channel':
                await this.channelSetup.handleChannelInput(msg, session);
                break;
                
            case 'awaiting_api_key':
                await this.channelSetup.handleApiKeyInput(msg, session);
                break;
                
            case 'api_key_input':
                await this.settings.handleApiKeyUpdate(msg, session);
                break;
                
            case 'awaiting_discount':
                await this.promoManagement.handleDiscountInput(msg, session);
                break;
                
            case 'awaiting_topup_bonus':
                await this.promoManagement.handleTopupBonusInput(msg, session);
                break;
        }
    }

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;
        
        await this.bot.answerCallbackQuery(query.id).catch(() => {});
        
        switch (data) {
            case 'setup_start':
                await this.channelSetup.startSetup(chatId, userId);
                break;
                
            case 'setup_cancel':
                await this.channelSetup.cancelSetup(query);
                break;
                
            case 'verify_admin':
                await this.channelSetup.handleAdminVerification(query);
                break;
                
            case 'settings_menu':
                await this.settings.showSettingsMenu(chatId, userId);
                break;
                
            case 'help_menu':
                await this.showHelpMenu(chatId);
                break;
                
            case 'donate_menu':
                await this.handleDonateMenu(query);
                break;
                
            case 'upload_start':
                await this.contentManagement.startUploadProcess(chatId, userId);
                break;
                
            case 'manage_channels':
                await this.settings.handleManageChannels(query);
                break;
                
            case 'change_api_key':
                await this.settings.handleChangeApiKey(query);
                break;
                
            case 'main_menu':
                await this.showMainMenu(query);
                break;
                
            case 'promo_menu':
                await this.promoManagement.showPromoMenu(chatId, userId);
                break;

            // New role selection callbacks
            case 'role_creator':
                await this.handleCreatorsMenu({ chat: { id: chatId }, from: { id: userId } });
                break;
                
            case 'role_viewer':
                await this.handleViewersMenu({ chat: { id: chatId }, from: { id: userId } });
                break;
                
            case 'show_help':
                await this.handleHelp({ chat: { id: chatId } });
                break;
                
            case 'contact_support':
                await this.handleSupport({ chat: { id: chatId } });
                break;

            // Creator menu callbacks
            case 'creator_channels':
                await this.settings.handleManageChannels(query);
                break;
                
            case 'creator_upload':
                await this.contentManagement.startUploadProcess(chatId, userId);
                break;
                
            case 'creator_promos':
                await this.promoManagement.showPromoMenu(chatId, userId);
                break;
                
            case 'creator_stats':
                await this.showCreatorStats(query);
                break;
                
            case 'creator_settings':
                await this.settings.showSettingsMenu(chatId, userId);
                break;
                
            case 'creator_payments':
                await this.showPaymentSettings(query);
                break;

            // Viewer menu callbacks
            case 'viewer_browse':
                await this.showContentBrowser(query);
                break;
                
            case 'viewer_balance':
                await this.consumerHandlers.handleBalance({ chat: { id: chatId }, from: { id: userId } });
                break;
                
            case 'viewer_library':
                await this.showUserLibrary(query);
                break;
                
            case 'viewer_history':
                await this.consumerHandlers.handleHistory({ chat: { id: chatId }, from: { id: userId } });
                break;
                
            case 'viewer_topup':
                await this.consumerHandlers.handleTopup({ chat: { id: chatId }, from: { id: userId } });
                break;
                
            case 'viewer_settings':
                await this.showViewerSettings(query);
                break;

            // Handle content posting confirmations
            default:
                // Check if this is a consumer callback
                if (data.startsWith('purchase_content_') || 
                    data.startsWith('confirm_payment_') || 
                    data.startsWith('cancel_payment_') ||
                    data.startsWith('confirm_topup_') ||
                    data.startsWith('cancel_topup_') ||
                    data.startsWith('create_qris_topup_') ||
                    data.startsWith('create_qris_content_') ||
                    data.startsWith('buy_video_') ||
                    data.startsWith('confirm_balance_') ||
                    data.startsWith('confirm_qris_') ||
                    data.startsWith('pay_qris_') ||
                    data.startsWith('check_payment_') ||
                    data === 'check_balance' ||
                    data === 'topup_balance' ||
                    data.startsWith('topup_') ||
                    data === 'continue_shopping' ||
                    data.startsWith('confirm_pending_purchase_') ||
                    data === 'cancel_pending_purchase' ||
                    data === 'my_account' ||
                    data === 'purchase_history' ||
                    data === 'transaction_history') {
                    
                    // Handle QRIS-specific callbacks first
                    if (data.startsWith('create_qris_topup_') ||
                        data.startsWith('create_qris_content_') ||
                        data.startsWith('pay_qris_') ||
                        data.startsWith('check_payment_') ||
                        data.startsWith('cancel_payment_')) {
                        await this.handleQRISCallbacks(query);
                    } else {
                        await this.consumerHandlers.handleCallbackQuery(query);
                    }
                    return;
                }
                
                // Creator-specific callbacks
                if (data.startsWith('post_')) {
                    const contentId = data.replace('post_', '');
                    await this.contentManagement.handleContentPosting(query, contentId);
                } else if (data.startsWith('edit_')) {
                    const contentId = data.replace('edit_', '');
                    await this.contentManagement.handleContentEdit(query, contentId);
                } else if (data.startsWith('delete_')) {
                    const contentId = data.replace('delete_', '');
                    await this.contentManagement.handleContentDelete(query, contentId);
                } else if (data.startsWith('channel_manage_')) {
                    const channelId = data.replace('channel_manage_', '');
                    await this.settings.handleChannelManage(query, channelId);
                } else if (data.startsWith('api_change_')) {
                    const channelId = data.replace('api_change_', '');
                    await this.settings.handleApiKeyChange(query, channelId);
                } else if (data.startsWith('delete_')) {
                    const channelId = data.replace('delete_', '');
                    await this.settings.handleChannelDelete(query, channelId);
                } else if (data.startsWith('confirm_delete_')) {
                    const channelId = data.replace('confirm_delete_', '');
                    await this.settings.handleChannelDeleteConfirm(query, channelId);
                } else if (data.startsWith('promo_select_')) {
                    const channelId = data.replace('promo_select_', '');
                    await this.promoManagement.showChannelPromoOptions(query, channelId);
                } else if (data.startsWith('promo_discount_')) {
                    const channelId = data.replace('promo_discount_', '');
                    await this.promoManagement.setupDiscountPromo(query, channelId);
                } else if (data.startsWith('promo_topup_')) {
                    const channelId = data.replace('promo_topup_', '');
                    await this.promoManagement.setupTopupBonusPromo(query, channelId);
                } else if (data.startsWith('promo_view_')) {
                    const channelId = data.replace('promo_view_', '');
                    await this.promoManagement.showActivePromos(query, channelId);
                }
                break;
        }
    }

    async showMainMenu(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        const user = await this.db.getUserById(userId);
        const channels = await this.db.getUserChannels(userId);
        
        const menuText = `
🏠 **Menu Utama - Bot Creator Papa**

👋 Selamat datang, ${user?.first_name || 'Creator'}!

📊 **Status Akun:**
🔗 Channel terdaftar: ${channels.length}
✅ Channel aktif: ${channels.filter(ch => ch.setup_completed).length}

Pilih menu yang ingin Anda akses:
        `;
        
        await this.bot.editMessageText(menuText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Setup Channel Baru', callback_data: 'setup_start' }],
                    [{ text: '📤 Upload Konten', callback_data: 'upload_start' }],
                    [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }],
                    [{ text: '🎉 Kelola Promosi', callback_data: 'promo_menu' }],
                    [{ text: '❓ Bantuan', callback_data: 'help_menu' }, { text: '🆘 Support', callback_data: 'donate_menu' }]
                ]
            }
        });
    }

    async showHelpMenu(chatId) {
        const TECH_SUPPORT_USERNAME = process.env.TECH_SUPPORT_USERNAME || 'titokt78';
        const TECH_SUPPORT_DISPLAY_NAME = process.env.TECH_SUPPORT_DISPLAY_NAME || 'papabadak';
        
        const helpText = `
❓ **Bantuan Bot Creator Papa**

**Perintah Utama:**
/start - Mulai menggunakan bot
/setup - Setup channel baru
/settings - Pengaturan channel dan API

**Cara Upload Konten:**
1. Pilih video + gambar thumbnail
2. Kirim bersamaan (media group)
3. Tambahkan caption: #harga#deskripsi
4. Contoh: #15000#Video tutorial menarik!

**Format yang Didukung:**
📹 Video: MP4, AVI, MOV (max 50MB)
🖼️ Gambar: JPG, PNG (untuk thumbnail)

**Dukungan Teknis:**
Hubungi @${TECH_SUPPORT_USERNAME} (${TECH_SUPPORT_DISPLAY_NAME}) untuk bantuan teknis.

**Fitur:**
✅ Multi-channel management
✅ Integrasi pembayaran OY Indonesia
✅ Preview sebelum posting
✅ Sistem keamanan berlapis
        `;
        
        await this.bot.sendMessage(chatId, helpText, {
            parse_mode: 'Markdown'
        });
    }

    async handleDonateMenu(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        const donateText = `
☕ **Traktir Kopi Buat Admin**

Terima kasih telah menggunakan Bot Creator Papa! 

Jika bot ini membantu bisnis konten Anda, dukung pengembangan dengan memberikan donasi.

💝 **Donasi membantu:**
• Maintenance server dan database
• Pengembangan fitur baru
• Support teknis 24/7
• Update keamanan

Setiap dukungan sangat berarti untuk kami! 🙏
        `;
        
        await this.bot.editMessageText(donateText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Donasi Sekarang', url: process.env.DONATION_URL || 'https://papabadak.carrd.co/' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                ]
            }
        });
        
        await this.db.logActivity(userId, null, 'donation_view', 'User viewed donation page');
    }

    // New placeholder methods for enhanced features
    async showCreatorStats(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        await this.bot.editMessageText(
            '📊 **Statistik Creator**\n\n🚧 Fitur ini sedang dalam pengembangan.\n\nAkan segera tersedia dengan data analytics lengkap!',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'role_creator' }]]
                }
            }
        );
    }

    async showPaymentSettings(query) {
        const chatId = query.message.chat.id;
        
        await this.bot.editMessageText(
            '💳 **Pengaturan Pembayaran**\n\n🚧 Fitur ini sedang dalam pengembangan.\n\nAkan tersedia pengaturan OY Indonesia dan payment gateway lainnya!',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'role_creator' }]]
                }
            }
        );
    }

    async showContentBrowser(query) {
        const chatId = query.message.chat.id;
        
        await this.bot.editMessageText(
            '🎬 **Browse Konten**\n\n🚧 Fitur ini sedang dalam pengembangan.\n\nAkan tersedia browser konten dari semua channel yang tersedia!',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'role_viewer' }]]
                }
            }
        );
    }

    async showUserLibrary(query) {
        const chatId = query.message.chat.id;
        
        await this.bot.editMessageText(
            '📚 **Konten Saya**\n\n🚧 Fitur ini sedang dalam pengembangan.\n\nAkan tersedia library konten yang sudah dibeli!',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'role_viewer' }]]
                }
            }
        );
    }

    async showViewerSettings(query) {
        const chatId = query.message.chat.id;
        
        await this.bot.editMessageText(
            '⚙️ **Pengaturan Viewer**\n\n🚧 Fitur ini sedang dalam pengembangan.\n\nAkan tersedia pengaturan notifikasi, preferensi, dll!',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'role_viewer' }]]
                }
            }
        );
    }

    // QRIS Payment Handlers
    async handleQRISCallbacks(query) {
        const data = query.data;
        
        // Create ContentPurchase instance
        const ContentPurchase = require('../consumer/content-purchase');
        const contentPurchase = new ContentPurchase(this.bot, this.db, this.userSessions, this.qrisHandler);
        
        if (data.startsWith('create_qris_topup_')) {
            const amount = parseInt(data.replace('create_qris_topup_', ''));
            await contentPurchase.handleCreateQRISTopup(query, amount);
        } else if (data.startsWith('create_qris_content_')) {
            const contentId = data.replace('create_qris_content_', '');
            await contentPurchase.handleCreateQRISContent(query, contentId);
        } else if (data.startsWith('pay_qris_')) {
            const contentId = data.replace('pay_qris_', '');
            await contentPurchase.handleQRISContentPayment(query, contentId);
        } else if (data.startsWith('check_payment_')) {
            const externalId = data.replace('check_payment_', '');
            await this.qrisHandler.handleCallbackQuery(query);
        } else if (data.startsWith('cancel_payment_')) {
            await this.qrisHandler.handleCallbackQuery(query);
            await this.bot.editMessageText(
                '❌ **Pembayaran dibatalkan**\n\nTransaksi telah dibatalkan oleh pengguna.',
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Kembali ke Menu', callback_data: 'role_viewer' }]]
                    }
                }
            );
        } else if (data.startsWith('check_payment_status_')) {
            const transactionId = data.substring('check_payment_status_'.length);
            await this.qrisHandler.checkPaymentStatus(chatId, transactionId);
        } else if (data.startsWith('purchase_content_')) {
            const contentId = data.substring('purchase_content_'.length);
            await this.contentManagement.handleContentPosting(query, contentId);
        }
    }
}

module.exports = MainHandlers;