import axios from 'axios';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

const sampleAgent = {
  owner: "demo_user",
  config: {
    name: "Balanced Trader",
    description: "A balanced decision-style trader with moderate risk management",
    market_focus: "1x2",
    ah_line_band: null,
    ou_line_band: null,
    decision_style: "volatility_breakout",
    confirmation_tolerance: "adaptive",
    score_state_mode: "momentum_only",
    side_bias: "none",
    risk_profile: "flat_stake",
    reaction_latency_ms: 3000,
    context_venue_aware: false,
    context_weather_aware: false,
    context_competition_tier_aware: false,
    wildcard_trait: "none",
    sizing: {
      type: "percent_of_budget",
      percentage: 5,
      fixed_stake: null,
      confidence_weighted: true
    },
    exit: {
      type: "stop_loss_take_profit",
      stop_loss: 8,
      take_profit: 20,
      time_based_exit_time: null
    },
    aggression: {
      type: "confirmation",
      cooldown_minutes: 3,
      confirmation_threshold: 2
    },
    direction: "bidirectional",
    phase_weighting: "full_match",
    max_reentries: 3,
    adaptivity: "static",
    risk_ceiling: {
      max_exposure_pct: 30,
      max_drawdown_stop_pct: 15
    }
  }
};

async function createSampleAgent() {
  try {
    console.log('Creating sample agent...');
    console.log('Configuration:', JSON.stringify(sampleAgent, null, 2));
    
    // Step 1: Create agent with strategy config only
    const agentResponse = await axios.post(`${SERVER_URL}/agents`, sampleAgent);
    const agentId = agentResponse.data.agent_id;
    
    console.log('\n✅ Agent created successfully!');
    console.log('Agent ID:', agentId);
    console.log('Status:', agentResponse.data.status);
    console.log('Message:', agentResponse.data.message);

    // Step 2: Run the agent with match_id and budget_cap
    const runResponse = await axios.post(`${SERVER_URL}/agents/${agentId}/run`, {
      match_id: "wc-2026-final",
      budget_cap: 10000
    });

    console.log('\n✅ Agent run started successfully!');
    console.log('Run ID:', runResponse.data.run_id);
    console.log('PID:', runResponse.data.pid);
    
  } catch (error) {
    console.error('\n❌ Failed to create/run agent:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
    process.exit(1);
  }
}

createSampleAgent();
