#!/bin/bash

# Bot Creator Papa Management Script
# Usage: ./bot-manager.sh [start|stop|restart|status|logs]

BOT_NAME="bot-creator-papa"
BOT_DIR="/var/www/araska.id/bots/bot-creator-papa"
LOG_DIR="$BOT_DIR/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

case "$1" in
    start)
        echo -e "${BLUE}Starting $BOT_NAME...${NC}"
        cd "$BOT_DIR"
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            echo -e "${YELLOW}Installing dependencies...${NC}"
            npm install
        fi
        
        # Start with PM2
        pm2 start ecosystem.config.js
        echo -e "${GREEN}$BOT_NAME started successfully!${NC}"
        ;;
        
    stop)
        echo -e "${YELLOW}Stopping $BOT_NAME...${NC}"
        pm2 stop $BOT_NAME
        echo -e "${GREEN}$BOT_NAME stopped!${NC}"
        ;;
        
    restart)
        echo -e "${YELLOW}Restarting $BOT_NAME...${NC}"
        pm2 restart $BOT_NAME
        echo -e "${GREEN}$BOT_NAME restarted!${NC}"
        ;;
        
    status)
        echo -e "${BLUE}Status of $BOT_NAME:${NC}"
        pm2 status $BOT_NAME
        ;;
        
    logs)
        echo -e "${BLUE}Showing logs for $BOT_NAME (Press Ctrl+C to exit):${NC}"
        pm2 logs $BOT_NAME --lines 50
        ;;
        
    monitor)
        echo -e "${BLUE}Opening PM2 monitor:${NC}"
        pm2 monit
        ;;
        
    setup-db)
        echo -e "${YELLOW}Setting up database...${NC}"
        cd "$BOT_DIR"
        mysql -u root -p < database.sql
        echo -e "${GREEN}Database setup complete!${NC}"
        ;;
        
    backup-db)
        echo -e "${YELLOW}Backing up database...${NC}"
        BACKUP_FILE="$LOG_DIR/db_backup_$(date +%Y%m%d_%H%M%S).sql"
        mysqldump -u root -p bot_creator_papa > "$BACKUP_FILE"
        echo -e "${GREEN}Database backed up to: $BACKUP_FILE${NC}"
        ;;
        
    *)
        echo -e "${RED}Usage: $0 {start|stop|restart|status|logs|monitor|setup-db|backup-db}${NC}"
        echo ""
        echo -e "${BLUE}Commands:${NC}"
        echo "  start     - Start the bot"
        echo "  stop      - Stop the bot"
        echo "  restart   - Restart the bot"
        echo "  status    - Show bot status"
        echo "  logs      - Show bot logs"
        echo "  monitor   - Open PM2 monitor"
        echo "  setup-db  - Setup MySQL database"
        echo "  backup-db - Backup database"
        exit 1
        ;;
esac