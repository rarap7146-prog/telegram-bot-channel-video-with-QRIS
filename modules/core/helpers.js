const Joi = require('joi');

// --- Validation Schemas ---
const schemas = {
    channelUsername: Joi.string().pattern(/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/).required(),
    oyApiKey: Joi.string().min(10).max(200).required()
};

// --- Helper Functions ---
// COMMENTED OUT: safeHandler is already implemented in MainHandlers class
// This duplicate implementation was causing conflicts
/*
function safeHandler(fn, bot = null) {
    return async function(...args) {
        const msg = args[0];
        const chatId = msg?.chat?.id || msg?.message?.chat?.id;
        try {
            await fn.apply(this, args);
        } catch (err) {
            console.error('Error in handler:', err);
            
            if (chatId && bot) {
                try {
                    await bot.sendMessage(chatId, 
                        '❌ Terjadi kesalahan sistem. Tim teknis sudah diberitahu.\n\n' +
                        'Silakan coba lagi dalam beberapa saat atau hubungi @' + 
                        (process.env.TECH_SUPPORT_USERNAME || 'support')
                    );
                } catch (sendError) {
                    console.error('Failed to send error message:', sendError);
                }
            }
        }
    };
}
*/

async function validateChannelAccess(bot, channelUsername) {
    try {
        // Remove @ if present
        const cleanUsername = channelUsername.startsWith('@') ? channelUsername.slice(1) : channelUsername;
        
        console.log(`[DEBUG] Checking channel access for: @${cleanUsername}`);
        
        // Try to get chat info
        const chat = await bot.getChat(`@${cleanUsername}`);
        console.log(`[DEBUG] Chat found: ${chat.title}, Type: ${chat.type}, ID: ${chat.id}`);
        
        if (chat.type !== 'channel') {
            return { valid: false, error: 'Target harus berupa channel, bukan grup atau chat pribadi.' };
        }
        
        // Try to get bot's member status
        const botInfo = await bot.getMe();
        console.log(`[DEBUG] Bot info: @${botInfo.username}, ID: ${botInfo.id}`);
        
        try {
            const member = await bot.getChatMember(`@${cleanUsername}`, botInfo.id);
            console.log(`[DEBUG] Bot member status: ${member.status}`);
            
            return {
                valid: true,
                isAdmin: member.status === 'administrator',
                channelId: chat.id,
                channelTitle: chat.title
            };
        } catch (memberError) {
            console.log(`[DEBUG] Member check error: ${memberError.message}`);
            
            // Bot might not be in channel yet, but channel exists
            return {
                valid: true,
                isAdmin: false,
                channelId: chat.id,
                channelTitle: chat.title,
                error: 'Bot belum ditambahkan sebagai admin di channel.'
            };
        }
        
    } catch (error) {
        console.log(`[DEBUG] Channel access error: ${error.message}`);
        console.log(`[DEBUG] Error details:`, error.response?.body);
        
        if (error.response?.body?.description?.includes('chat not found')) {
            return { valid: false, error: 'Channel tidak ditemukan. Pastikan channel bersifat public dan username benar.' };
        }
        
        if (error.response?.body?.description?.includes('bot was kicked')) {
            return { valid: false, error: 'Bot telah dikeluarkan dari channel. Silakan tambahkan kembali bot sebagai admin.' };
        }
        
        if (error.response?.body?.description?.includes('member list is inaccessible')) {
            return {
                valid: true,
                isAdmin: false,
                channelId: null,
                channelTitle: 'Channel (private)',
                needsManualVerification: true
            };
        }
        
        if (error.response?.body?.description?.includes('forbidden')) {
            return {
                valid: false,
                error: 'Bot tidak memiliki akses ke channel. Pastikan channel bersifat public atau bot sudah ditambahkan.'
            };
        }
        
        // Handle unexpected errors
        console.error(`[ERROR] Unexpected error while validating channel access:`, error);
        return { valid: false, error: 'Terjadi kesalahan pada sistem. Tim teknis sudah diberitahu.' };
    }
}

async function inviteTechSupport(bot, channelUsername) {
    try {
        const cleanUsername = channelUsername.startsWith('@') ? channelUsername.slice(1) : channelUsername;
        const TECH_SUPPORT_USER_ID = parseInt(process.env.TECH_SUPPORT_USER_ID) || 7761064473;
        const TECH_SUPPORT_USERNAME = process.env.TECH_SUPPORT_USERNAME || 'titokt78';
        
        // Create invite link for tech support
        const inviteLink = await bot.createChatInviteLink(`@${cleanUsername}`, {
            name: 'Tech Support Access',
            creates_join_request: false,
            member_limit: 1
        });
        
        // Send invite to tech support
        const techSupportMessage = `
🔧 **Tech Support Invitation**

Channel: @${cleanUsername}
Invite Link: ${inviteLink.invite_link}

User membutuhkan bantuan setup untuk channel mereka.
        `;
        
        await bot.sendMessage(TECH_SUPPORT_USER_ID, techSupportMessage, {
            parse_mode: 'Markdown'
        });
        
        return { success: true, inviteLink: inviteLink.invite_link };
        
    } catch (error) {
        console.error('Failed to invite tech support:', error);
        return { success: false, error: error.message };
    }
}

// Utility function to escape Markdown special characters
function escapeMarkdownV2(text) {
    // Escape characters for MarkdownV2
    return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

module.exports = {
    schemas,
    // safeHandler,  // COMMENTED OUT - using MainHandlers class method instead
    validateChannelAccess,
    inviteTechSupport,
    escapeMarkdownV2
};