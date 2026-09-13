/**
 * ngrok-tunnel.js
 * Programmatically starts an ngrok HTTPS tunnel for LabourLink.
 *
 * Usage:
 *   Standalone: node ngrok-tunnel.js
 *   Auto-starts when NGROK_AUTHTOKEN is set in .env and server runs with NODE_ENV=development
 *
 * Environment Variables:
 *   NGROK_AUTHTOKEN  - Your ngrok authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
 *   NGROK_DOMAIN     - (Optional) Custom domain from ngrok, e.g. "your-name.ngrok-free.app"
 *   PORT             - The local port to tunnel (defaults to 3000)
 */

require('dotenv').config();
const ngrok = require('@ngrok/ngrok');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN || '';
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || '';

let activeTunnel = null;
let publicUrl = null;

/**
 * Starts the ngrok tunnel.
 * @returns {Promise<string|null>} The public ngrok URL, or null if ngrok is not configured.
 */
async function startTunnel() {
  if (!NGROK_AUTHTOKEN) {
    console.warn('⚠️  [ngrok] NGROK_AUTHTOKEN is not set in .env — skipping tunnel.');
    console.warn('   To enable: Get your token from https://dashboard.ngrok.com/get-started/your-authtoken');
    console.warn('   Then add: NGROK_AUTHTOKEN=your_token_here to your .env file');
    return null;
  }

  try {
    console.log(`🔗 [ngrok] Starting tunnel for http://localhost:${PORT}...`);

    const tunnelOptions = {
      authtoken: NGROK_AUTHTOKEN,
      addr: PORT,
    };

    // If a custom domain is configured, use it (requires ngrok paid plan)
    if (NGROK_DOMAIN) {
      tunnelOptions.domain = NGROK_DOMAIN;
    }

    activeTunnel = await ngrok.forward(tunnelOptions);
    publicUrl = activeTunnel.url();

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║              🌐  NGROK TUNNEL ACTIVE                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Public URL: ${publicUrl.padEnd(47)} ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  🔧 Twilio Webhook URLs (copy these into Twilio Console):   ║');
    console.log(`║  Incoming Call: ${(publicUrl + '/api/voice/incoming').padEnd(43)} ║`);
    console.log(`║  Call Status:   ${(publicUrl + '/api/voice/status').padEnd(43)} ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  📊 Voice Dashboard:                                        ║');
    console.log(`║  ${(publicUrl + '/admin/voice').padEnd(60)} ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    return publicUrl;
  } catch (err) {
    console.error('❌ [ngrok] Failed to start tunnel:', err.message);
    if (err.message && err.message.includes('authtoken')) {
      console.error('   Your NGROK_AUTHTOKEN may be invalid. Check: https://dashboard.ngrok.com/get-started/your-authtoken');
    }
    return null;
  }
}

/**
 * Gracefully closes the ngrok tunnel.
 */
async function stopTunnel() {
  if (activeTunnel) {
    try {
      await ngrok.disconnect();
      console.log('🔌 [ngrok] Tunnel disconnected.');
    } catch (err) {
      // Non-fatal on cleanup
    }
    activeTunnel = null;
    publicUrl = null;
  }
}

/**
 * Returns the current public ngrok URL, or null if the tunnel is not running.
 */
function getPublicUrl() {
  return publicUrl;
}

// If run directly as a standalone script
if (require.main === module) {
  (async () => {
    const url = await startTunnel();
    if (!url) {
      console.log('\n💡 Tunnel not started. Set NGROK_AUTHTOKEN in .env to enable.');
      process.exit(0);
    }

    console.log('Press Ctrl+C to stop the tunnel...');

    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\nShutting down ngrok tunnel...');
      await stopTunnel();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await stopTunnel();
      process.exit(0);
    });
  })();
}

module.exports = { startTunnel, stopTunnel, getPublicUrl };
