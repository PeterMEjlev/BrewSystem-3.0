#!/bin/bash
# Deployment script for Brew System v3 to Raspberry Pi
# Usage: ./deploy-to-pi.sh [pi-hostname]

PI_HOST=${1:-raspberrypi.local}
PI_USER=pi
REMOTE_DIR=/home/pi/brew-system-v3

echo "🍺 Brew System v3 - Raspberry Pi Deployment Script"
echo "=================================================="
echo ""

# Build the application
echo "📦 Building production bundle..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully"
echo ""

# Check if Pi is reachable
echo "🔍 Checking connection to $PI_HOST..."
ping -c 1 $PI_HOST > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Cannot reach $PI_HOST. Please check network connection."
    exit 1
fi

echo "✅ Connected to $PI_HOST"
echo ""

# Copy files to Pi
echo "📤 Transferring files to Raspberry Pi..."
scp -r dist/ electron/ package.json $PI_USER@$PI_HOST:$REMOTE_DIR/

if [ $? -ne 0 ]; then
    echo "❌ File transfer failed!"
    exit 1
fi

echo "✅ Files transferred successfully"
echo ""

# Install Electron on Pi and restart services
echo "🔧 Installing Electron and restarting services..."
ssh $PI_USER@$PI_HOST << EOF
    cd $REMOTE_DIR
    npm install electron --save-dev
    sudo systemctl restart brew-system.service
EOF

if [ $? -ne 0 ]; then
    echo "⚠️  Remote setup failed. You may need to do this manually:"
    echo "   ssh $PI_USER@$PI_HOST"
    echo "   cd $REMOTE_DIR && npm install electron --save-dev"
    echo "   sudo systemctl restart brew-system.service"
    exit 1
fi

echo "✅ Installation completed"
echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📱 Electron kiosk will launch on next boot, or run manually:"
echo "   ssh $PI_USER@$PI_HOST 'cd $REMOTE_DIR && npx electron .'"
echo ""
