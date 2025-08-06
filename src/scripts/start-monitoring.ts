#!/usr/bin/env tsx

import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { SmartContractMonitoring } from '../services/monitoring/index.ts';
import { getMonitoringConfig, validateMonitoringConfig } from '../config/monitoring.ts';
import { exampleAlertRules, exampleAlertChannels } from '../config/monitoring.ts';

async function startMonitoring() {
  console.log('🚀 Starting Smart Contract Monitoring System...\n');

  try {
    // Load configuration
    console.log('📋 Loading configuration...');
    const config = getMonitoringConfig();
    
    // Validate configuration
    console.log('✅ Validating configuration...');
    const validationErrors = validateMonitoringConfig(config);
    
    if (validationErrors.length > 0) {
      console.error('❌ Configuration validation failed:');
      validationErrors.forEach(error => console.error(`   - ${error}`));
      process.exit(1);
    }
    
    console.log('✅ Configuration validated successfully');

    // Create Solana connection
    console.log('🔗 Connecting to Solana network...');
    const connection = new Connection(config.rpcUrl, config.commitment);
    
    // Test connection
    try {
      const slot = await connection.getSlot();
      console.log(`✅ Connected to Solana at slot ${slot}`);
    } catch (error) {
      console.error('❌ Failed to connect to Solana:', error);
      process.exit(1);
    }

    // Initialize monitoring system
    console.log('🔧 Initializing monitoring system...');
    const monitoring = SmartContractMonitoring.getInstance(connection, config);
    
    // Add example alert rules if none exist
    if (config.alertRules.length === 0) {
      console.log('📝 Adding example alert rules...');
      for (const rule of exampleAlertRules) {
        await monitoring.addAlertRule(rule);
      }
    }
    
    // Add example alert channels if none exist
    if (config.alertChannels.length === 0) {
      console.log('📢 Adding example alert channels...');
      for (const channel of exampleAlertChannels) {
        if (channel.enabled) {
          await monitoring.addAlertChannel(channel);
        }
      }
    }

    // Start monitoring
    console.log('▶️  Starting monitoring services...');
    await monitoring.start();
    
    console.log('✅ Smart Contract Monitoring System started successfully!');
    console.log('\n📊 Monitoring Dashboard:');
    console.log(`   - Program ID: ${config.programId}`);
    console.log(`   - RPC URL: ${config.rpcUrl}`);
    console.log(`   - Poll Interval: ${config.pollInterval}ms`);
    console.log(`   - Health Check Interval: ${config.healthCheckInterval}ms`);
    console.log(`   - Alert Rules: ${config.alertRules.length}`);
    console.log(`   - Alert Channels: ${config.alertChannels.filter(c => c.enabled).length}`);
    
    console.log('\n🔍 Available API Endpoints:');
    console.log('   - GET  /api/monitoring/status');
    console.log('   - GET  /api/monitoring/dashboard');
    console.log('   - GET  /api/monitoring/events');
    console.log('   - GET  /api/monitoring/metrics');
    console.log('   - GET  /api/monitoring/health');
    console.log('   - POST /api/monitoring/start');
    console.log('   - POST /api/monitoring/stop');
    
    console.log('\n🚨 Alert Management:');
    console.log('   - GET    /api/monitoring/alerts/rules');
    console.log('   - POST   /api/monitoring/alerts/rules');
    console.log('   - PUT    /api/monitoring/alerts/rules/:id');
    console.log('   - DELETE /api/monitoring/alerts/rules/:id');
    console.log('   - GET    /api/monitoring/alerts/channels');
    console.log('   - POST   /api/monitoring/alerts/channels');
    console.log('   - PUT    /api/monitoring/alerts/channels/:id');
    console.log('   - DELETE /api/monitoring/alerts/channels/:id');
    
    console.log('\n📈 Real-time monitoring is now active!');
    console.log('Press Ctrl+C to stop monitoring...\n');

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down monitoring system...');
      try {
        await monitoring.stop();
        console.log('✅ Monitoring system stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping monitoring system:', error);
        process.exit(1);
      }
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      try {
        await monitoring.stop();
        console.log('✅ Monitoring system stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping monitoring system:', error);
        process.exit(1);
      }
    });

    // Set up periodic status updates
    setInterval(() => {
      if (monitoring.isActive()) {
        const metrics = monitoring.getMetrics();
        const healthStatus = monitoring.getHealthStatus();
        
        console.log(`📊 Status Update - Events: ${metrics.totalEvents}, Health: ${healthStatus.status}`);
      }
    }, 60000); // Every minute

  } catch (error) {
    console.error('❌ Failed to start monitoring system:', error);
    process.exit(1);
  }
}

// Run the monitoring system
if (require.main === module) {
  startMonitoring().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

export { startMonitoring }; 