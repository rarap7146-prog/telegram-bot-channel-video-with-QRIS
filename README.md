# Bot Creator Papa

Multi-tenant Telegram bot for content creator channel management with integrated payment system.

## Features

- 🎬 **Multi-Channel Management**: Support multiple channels per user
- 💰 **Payment Integration**: OY Indonesia API integration for QRIS payments
- 📤 **Media Upload**: Handle video + thumbnail uploads with pricing
- 🔒 **Security**: Encrypted API key storage and admin verification
- 📊 **Preview System**: Preview content before posting to channels
- 🔧 **Tech Support**: Automatic tech support invitation system

## Quick Start

### 1. Database Setup
```bash
# Create MySQL database
mysql -u root -p < database.sql

# Update database credentials in .env
cp .env.example .env
nano .env
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configuration
Edit `.env` file with your settings:
- `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather
- `DB_*`: MySQL database credentials
- `ENCRYPTION_KEY`: 32-character key for API key encryption
- `WEBHOOK_URL`: Your domain webhook URL

### 4. Run Bot
```bash
# Development mode (polling)
npm run dev

# Production mode (webhook)
npm run webhook

# Using PM2 (recommended for production)
./bot-manager.sh start
```

## Bot Commands

- `/start` - Welcome message and main menu
- `/setup` - Setup new channel integration
- `/settings` - Manage channels and API keys

## Usage Flow

### For Content Creators:

1. **Setup Channel**
   - Use `/setup` command
   - Enter channel username (@yourchannel)
   - Enter OY Indonesia API key
   - Add bot as channel admin
   - Tech support (@titokt78) will be automatically invited

2. **Upload Content**
   - Send video + image + caption in media group
   - Format caption: `#price#description`
   - Example: `#15000#Amazing tutorial video!`
   - Preview and confirm before posting

3. **Manage Settings**
   - Use `/settings` to update channel or API key
   - View channel statistics
   - Manage multiple channels

## Architecture

### Database Schema
- **users**: Telegram user accounts
- **channels**: Channel configurations with encrypted API keys
- **media_content**: Uploaded content with pricing
- **media_upload_sessions**: Temporary upload sessions
- **activity_logs**: System activity tracking

### Security Features
- API key encryption using AES-256
- Admin verification for channel access
- Read-only database user for bot-content-papa
- Comprehensive activity logging
- Safe error handling with user notifications

## API Integration

### OY Indonesia Payment Gateway
- **Environment Switching**: Easy sandbox/production switching via `OY_ENVIRONMENT`
- **Sandbox URL**: `https://api-stg.oyindonesia.com` (for testing)
- **Production URL**: `https://partner.oyindonesia.com` (for live payments)
- **Secure API Key Storage**: Encrypted in database
- **QRIS Payment Generation**: Real-time QRIS code creation
- **Transaction Monitoring**: Automated payment status tracking
- **Mock Fallback**: Automatic fallback to mock responses for testing

#### Environment Configuration
```bash
# For testing/development
OY_ENVIRONMENT=sandbox

# For production
OY_ENVIRONMENT=production
```

### Bot-Content-Papa Integration
- Read-only database access
- Shared content and pricing data
- Independent payment processing
- Channel and media information sync

## Development

### Project Structure
```
/var/www/araska.id/bots/bot-creator-papa/
├── index.js              # Main bot application
├── database.js           # Database connection and queries
├── database.sql          # Database schema
├── package.json          # Dependencies and scripts
├── ecosystem.config.js   # PM2 configuration
├── bot-manager.sh        # Management script
├── .env.example          # Environment template
└── logs/                 # Application logs
```

### Database Management
```bash
# Setup database
./bot-manager.sh setup-db

# Backup database
./bot-manager.sh backup-db

# View logs
./bot-manager.sh logs
```

### Monitoring
```bash
# Check bot status
./bot-manager.sh status

# Open PM2 monitor
./bot-manager.sh monitor

# Restart bot
./bot-manager.sh restart
```

## Tech Support

- Username: @titokt78 (papabadak)
- User ID: 7761064473
- Auto-invitation to all new channels
- Technical assistance for setup issues

## License

MIT License - Created by TitoKT78