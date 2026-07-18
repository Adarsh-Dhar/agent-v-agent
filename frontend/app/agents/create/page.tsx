'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/header'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { useAuth } from '@/app/providers'
import { AGENT_PRESETS } from '@/lib/agent-presets'
import * as ConfigOptions from '@/lib/agent-config-options'

export default function CreateAgentPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [agentName, setAgentName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Custom form state
  const [customConfig, setCustomConfig] = useState({
    market_focus: '1x2' as ConfigOptions.MarketFocus,
    ah_line_band: 'tight' as ConfigOptions.AhLineBand,
    ou_line_band: 'mid' as ConfigOptions.OuLineBand,
    decision_style: 'volatility_breakout' as ConfigOptions.DecisionStyle,
    confirmation_tolerance: 'adaptive' as ConfigOptions.ConfirmationTolerance,
    score_state_mode: 'momentum_only' as ConfigOptions.ScoreStateMode,
    side_bias: 'none' as ConfigOptions.SideBias,
    risk_profile: 'flat_stake' as ConfigOptions.RiskProfile,
    wildcard_trait: 'none' as ConfigOptions.WildcardTrait,
    position_sizing: 'fixed' as ConfigOptions.Sizing,
    fixed_stake: 100,
    percentage_stake: 10,
    exit_rule: 'stop_loss_take_profit' as ConfigOptions.Exit,
    stop_loss: 5,
    take_profit: 15,
    aggression: 'instant' as ConfigOptions.Aggression,
    cooldown_minutes: 2,
    confirmation_threshold: 2,
    direction_bias: 'bidirectional' as ConfigOptions.Direction,
    target_selection: 'both' as ConfigOptions.TargetSelection,
    phase_weighting: 'full_match' as ConfigOptions.PhaseWeighting,
    reaction_latency_ms: 3000,
    reentry_rule: 'capped_reentry' as ConfigOptions.ReentryRule,
    max_reentries: 5,
    portfolio_behavior: 'independent' as ConfigOptions.PortfolioBehavior,
    adaptivity_mode: 'static' as ConfigOptions.Adaptivity,
    context_venue_aware: false,
    context_weather_aware: false,
    context_competition_tier_aware: false,
    max_exposure_pct: 100,
    max_drawdown_stop_pct: 100,
    volatility_window: 6,
    breakout_zscore: 1.5,
  })

  const validateCustomConfig = () => {
    const errors: Record<string, string> = {}

    if (!agentName.trim()) {
      errors.name = 'Please enter an agent name'
    }

    // Numeric validations matching validateConfig.js
    if (customConfig.fixed_stake !== undefined) {
      if (typeof customConfig.fixed_stake !== 'number' || customConfig.fixed_stake < 10 || customConfig.fixed_stake > 1000) {
        errors.fixed_stake = 'Must be between 10 and 1000'
      }
    }

    if (customConfig.percentage_stake !== undefined) {
      if (typeof customConfig.percentage_stake !== 'number' || customConfig.percentage_stake < 1 || customConfig.percentage_stake > 100) {
        errors.percentage_stake = 'Must be between 1 and 100'
      }
    }

    if (customConfig.stop_loss !== undefined) {
      if (typeof customConfig.stop_loss !== 'number' || customConfig.stop_loss < 1 || customConfig.stop_loss > 50) {
        errors.stop_loss = 'Must be between 1 and 50'
      }
    }

    if (customConfig.take_profit !== undefined) {
      if (typeof customConfig.take_profit !== 'number' || customConfig.take_profit < 1 || customConfig.take_profit > 50) {
        errors.take_profit = 'Must be between 1 and 50'
      }
    }

    if (customConfig.cooldown_minutes !== undefined) {
      if (typeof customConfig.cooldown_minutes !== 'number' || customConfig.cooldown_minutes < 1 || customConfig.cooldown_minutes > 30) {
        errors.cooldown_minutes = 'Must be between 1 and 30'
      }
    }

    if (customConfig.max_reentries !== undefined) {
      if (typeof customConfig.max_reentries !== 'number' || customConfig.max_reentries < 0 || customConfig.max_reentries > 20) {
        errors.max_reentries = 'Must be between 0 and 20'
      }
    }

    if (customConfig.reaction_latency_ms !== undefined) {
      if (typeof customConfig.reaction_latency_ms !== 'number' || customConfig.reaction_latency_ms < 0 || customConfig.reaction_latency_ms > 30000) {
        errors.reaction_latency_ms = 'Must be between 0 and 30000'
      }
    }

    if (customConfig.max_exposure_pct !== undefined) {
      if (typeof customConfig.max_exposure_pct !== 'number' || customConfig.max_exposure_pct < 0 || customConfig.max_exposure_pct > 100) {
        errors.max_exposure_pct = 'Must be between 0 and 100'
      }
    }

    if (customConfig.max_drawdown_stop_pct !== undefined) {
      if (typeof customConfig.max_drawdown_stop_pct !== 'number' || customConfig.max_drawdown_stop_pct < 0 || customConfig.max_drawdown_stop_pct > 100) {
        errors.max_drawdown_stop_pct = 'Must be between 0 and 100'
      }
    }

    if (customConfig.confirmation_threshold !== undefined) {
      if (typeof customConfig.confirmation_threshold !== 'number' || customConfig.confirmation_threshold < 1 || customConfig.confirmation_threshold > 10) {
        errors.confirmation_threshold = 'Must be between 1 and 10'
      }
    }

    if (customConfig.volatility_window !== undefined) {
      if (typeof customConfig.volatility_window !== 'number' || customConfig.volatility_window < 3 || customConfig.volatility_window > 20) {
        errors.volatility_window = 'Must be between 3 and 20'
      }
    }

    if (customConfig.breakout_zscore !== undefined) {
      if (typeof customConfig.breakout_zscore !== 'number' || customConfig.breakout_zscore < 1.0 || customConfig.breakout_zscore > 4.0) {
        errors.breakout_zscore = 'Must be between 1.0 and 4.0'
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setValidationErrors({})

    if (!user?.id) {
      setError('You must be logged in to create an agent')
      return
    }

    if (!agentName.trim()) {
      setError('Please enter an agent name')
      return
    }

    if (mode === 'preset') {
      if (!selectedPreset) {
        setError('Please select an agent preset')
        return
      }

      const preset = AGENT_PRESETS.find(p => p.id === selectedPreset)
      if (!preset) {
        setError('Invalid preset selected')
        return
      }

      setIsSubmitting(true)

      try {
        const response = await fetch('/api/agents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            owner: user?.id,
            config: {
              name: agentName,
              description: preset.description,
              market_focus: preset.marketFocus,
              decision_style: preset.decisionStyle,
              confirmation_tolerance: preset.confirmationTolerance,
              side_bias: preset.sideBias,
              reaction_latency_ms: preset.reactionLatencyMs,
              context_venue_aware: preset.contextVenueAware,
              context_weather_aware: preset.contextWeatherAware,
              wildcard_trait: preset.wildcardTrait,
              sizing: {
                type: preset.positionSizing,
                percentage: 10,
                fixed_stake: 100,
                confidence_weighted: preset.positionSizing === 'confidence_weighted',
              },
              exit: {
                type: 'stop_loss_take_profit',
                stop_loss: 5,
                take_profit: 15,
              },
              aggression: {
                type: preset.aggressionType,
                cooldown_minutes: 2,
                confirmation_threshold: 2,
              },
              direction: 'bidirectional',
              target_selection: 'both',
              phase_weighting: preset.phaseWeighting,
              reentry_rule: 'capped_reentry',
              max_reentries: 5,
              portfolio_behavior: 'independent',
              adaptivity: 'static',
              ...(preset.decisionStyle === 'volatility_breakout' && {
                volatility_window: preset.volatilityWindow,
                breakout_zscore: preset.breakoutZscore,
              }),
            },
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create agent')
        }

        router.push('/agents')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create agent')
      } finally {
        setIsSubmitting(false)
      }
    } else {
      // Custom mode
      if (!validateCustomConfig()) {
        setError('Please fix validation errors')
        return
      }

      setIsSubmitting(true)

      try {
        const response = await fetch('/api/agents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            owner: user?.id,
            config: {
              name: agentName,
              description: 'Custom agent configuration',
              market_focus: customConfig.market_focus,
              ah_line_band: customConfig.market_focus === 'asian_handicap' ? customConfig.ah_line_band : undefined,
              ou_line_band: customConfig.market_focus === 'over_under' ? customConfig.ou_line_band : undefined,
              decision_style: customConfig.decision_style,
              confirmation_tolerance: customConfig.confirmation_tolerance,
              score_state_mode: customConfig.score_state_mode,
              side_bias: customConfig.side_bias,
              risk_profile: customConfig.risk_profile,
              wildcard_trait: customConfig.wildcard_trait,
              sizing: {
                type: customConfig.position_sizing,
                percentage: customConfig.percentage_stake,
                fixed_stake: customConfig.fixed_stake,
                confidence_weighted: customConfig.position_sizing === 'confidence_weighted',
              },
              exit: {
                type: customConfig.exit_rule,
                stop_loss: customConfig.stop_loss,
                take_profit: customConfig.take_profit,
              },
              aggression: {
                type: customConfig.aggression,
                cooldown_minutes: customConfig.cooldown_minutes,
                confirmation_threshold: customConfig.confirmation_threshold,
              },
              direction: customConfig.direction_bias,
              target_selection: customConfig.target_selection,
              phase_weighting: customConfig.phase_weighting,
              reaction_latency_ms: customConfig.reaction_latency_ms,
              reentry_rule: customConfig.reentry_rule,
              max_reentries: customConfig.max_reentries,
              portfolio_behavior: customConfig.portfolio_behavior,
              adaptivity: customConfig.adaptivity_mode,
              context_venue_aware: customConfig.context_venue_aware,
              context_weather_aware: customConfig.context_weather_aware,
              context_competition_tier_aware: customConfig.context_competition_tier_aware,
              max_exposure_pct: customConfig.max_exposure_pct,
              max_drawdown_stop_pct: customConfig.max_drawdown_stop_pct,
              ...(customConfig.decision_style === 'volatility_breakout' && {
                volatility_window: customConfig.volatility_window,
                breakout_zscore: customConfig.breakout_zscore,
              }),
            },
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create agent')
        }

        router.push('/agents')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create agent')
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-foreground/70 hover:text-foreground mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create New Agent</h1>
          <p className="text-foreground/60">
            {mode === 'preset'
              ? 'Choose a trading strategy preset and customize it with your own name'
              : 'Build a custom agent configuration with full control over all parameters'}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="mb-8 bg-card rounded-lg p-1 border border-border inline-flex">
          <button
            type="button"
            onClick={() => {
              setMode('preset')
              setValidationErrors({})
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'preset'
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground/70 hover:text-foreground'
            }`}
          >
            Use a Preset
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('custom')
              setSelectedPreset(null)
              setValidationErrors({})
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground/70 hover:text-foreground'
            }`}
          >
            Build Custom
          </button>
        </div>

        <form onSubmit={handleCreateAgent}>
          {/* Agent Name Input */}
          <div className="mb-8 bg-card rounded-lg p-6 border border-border">
            <label className="block text-sm font-medium mb-2">Agent Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g., My Aggressive Trader"
              className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-foreground/50 mt-2">
              Give your agent a unique name to identify it in matches
            </p>
            {validationErrors.name && (
              <p className="text-xs text-red-500 mt-1">{validationErrors.name}</p>
            )}
          </div>

          {mode === 'preset' ? (
            /* Presets Grid */
            <div className="mb-8">
              <label className="block text-sm font-medium mb-4">Select Strategy Preset</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {AGENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPreset(preset.id)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      selectedPreset === preset.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-foreground">{preset.name}</h3>
                        <p className="text-xs text-foreground/60 mt-1">{preset.description}</p>
                      </div>
                      {selectedPreset === preset.id && (
                        <Check className="w-5 h-5 text-primary flex-shrink-0" />
                      )}
                    </div>

                    {/* Preset Details */}
                    <div className="mt-3 space-y-1 text-xs text-foreground/70">
                      <div className="flex justify-between">
                        <span>Market:</span>
                        <span className="font-medium capitalize">{preset.marketFocus.replace('_', ' ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Style:</span>
                        <span className="font-medium capitalize">{preset.decisionStyle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Phase:</span>
                        <span className="font-medium capitalize">{preset.phaseWeighting.replace('_', ' ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Reaction:</span>
                        <span className="font-medium">{preset.reactionLatencyMs}ms</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Custom Form Controls */
            <div className="space-y-6">
              {/* Market */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Market</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Market Focus</label>
                    <select
                      value={customConfig.market_focus}
                      onChange={(e) => setCustomConfig({ ...customConfig, market_focus: e.target.value as ConfigOptions.MarketFocus })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.MARKET_FOCUS.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.market_focus === 'asian_handicap' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">AH Line Band</label>
                      <select
                        value={customConfig.ah_line_band}
                        onChange={(e) => setCustomConfig({ ...customConfig, ah_line_band: e.target.value as ConfigOptions.AhLineBand })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {ConfigOptions.AH_LINE_BAND.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {customConfig.market_focus === 'over_under' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">OU Line Band</label>
                      <select
                        value={customConfig.ou_line_band}
                        onChange={(e) => setCustomConfig({ ...customConfig, ou_line_band: e.target.value as ConfigOptions.OuLineBand })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {ConfigOptions.OU_LINE_BAND.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Signal */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Signal</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Decision Style</label>
                    <select
                      value={customConfig.decision_style}
                      onChange={(e) => setCustomConfig({ ...customConfig, decision_style: e.target.value as ConfigOptions.DecisionStyle })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.DECISION_STYLE.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.decision_style === 'volatility_breakout' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Volatility Window (3-20)</label>
                        <input
                          type="number"
                          min="3"
                          max="20"
                          value={customConfig.volatility_window}
                          onChange={(e) => setCustomConfig({ ...customConfig, volatility_window: parseInt(e.target.value) || 6 })}
                          className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {validationErrors.volatility_window && (
                          <p className="text-xs text-red-500 mt-1">{validationErrors.volatility_window}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Breakout Z-Score (1.0-4.0)</label>
                        <input
                          type="number"
                          min="1.0"
                          max="4.0"
                          step="0.1"
                          value={customConfig.breakout_zscore}
                          onChange={(e) => setCustomConfig({ ...customConfig, breakout_zscore: parseFloat(e.target.value) || 1.5 })}
                          className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {validationErrors.breakout_zscore && (
                          <p className="text-xs text-red-500 mt-1">{validationErrors.breakout_zscore}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Confirmation & Score-State */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Confirmation & Score-State</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Confirmation Tolerance</label>
                    <select
                      value={customConfig.confirmation_tolerance}
                      onChange={(e) => setCustomConfig({ ...customConfig, confirmation_tolerance: e.target.value as ConfigOptions.ConfirmationTolerance })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.CONFIRMATION_TOLERANCE.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Score State Mode</label>
                    <select
                      value={customConfig.score_state_mode}
                      onChange={(e) => setCustomConfig({ ...customConfig, score_state_mode: e.target.value as ConfigOptions.ScoreStateMode })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.SCORE_STATE_MODE.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Bias & Risk */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Bias & Risk</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Side Bias</label>
                    <select
                      value={customConfig.side_bias}
                      onChange={(e) => setCustomConfig({ ...customConfig, side_bias: e.target.value as ConfigOptions.SideBias })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.SIDE_BIAS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Risk Profile</label>
                    <select
                      value={customConfig.risk_profile}
                      onChange={(e) => setCustomConfig({ ...customConfig, risk_profile: e.target.value as ConfigOptions.RiskProfile })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.RISK_PROFILE.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Wildcard Trait</label>
                    <select
                      value={customConfig.wildcard_trait}
                      onChange={(e) => setCustomConfig({ ...customConfig, wildcard_trait: e.target.value as ConfigOptions.WildcardTrait })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.WILDCARD_TRAIT.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Sizing */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Position Sizing</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Position Sizing</label>
                    <select
                      value={customConfig.position_sizing}
                      onChange={(e) => setCustomConfig({ ...customConfig, position_sizing: e.target.value as ConfigOptions.Sizing })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.SIZING.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.position_sizing === 'fixed' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Fixed Stake (10-1000)</label>
                      <input
                        type="number"
                        min="10"
                        max="1000"
                        value={customConfig.fixed_stake}
                        onChange={(e) => setCustomConfig({ ...customConfig, fixed_stake: parseInt(e.target.value) || 100 })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {validationErrors.fixed_stake && (
                        <p className="text-xs text-red-500 mt-1">{validationErrors.fixed_stake}</p>
                      )}
                    </div>
                  )}
                  {(customConfig.position_sizing === 'percentage' || customConfig.position_sizing === 'percent_of_budget' || customConfig.position_sizing === 'confidence_weighted') && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Percentage Stake (1-100)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={customConfig.percentage_stake}
                        onChange={(e) => setCustomConfig({ ...customConfig, percentage_stake: parseInt(e.target.value) || 10 })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {validationErrors.percentage_stake && (
                        <p className="text-xs text-red-500 mt-1">{validationErrors.percentage_stake}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Exit */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Exit Rule</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Exit Rule</label>
                    <select
                      value={customConfig.exit_rule}
                      onChange={(e) => setCustomConfig({ ...customConfig, exit_rule: e.target.value as ConfigOptions.Exit })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.EXIT.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(customConfig.exit_rule === 'stop_loss_take_profit' || customConfig.exit_rule === 'stop-loss') && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Stop Loss (1-50)</label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={customConfig.stop_loss}
                          onChange={(e) => setCustomConfig({ ...customConfig, stop_loss: parseInt(e.target.value) || 5 })}
                          className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                       {validationErrors.stop_loss && (
                          <p className="text-xs text-red-500 mt-1">{validationErrors.stop_loss}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Take Profit (1-50)</label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={customConfig.take_profit}
                          onChange={(e) => setCustomConfig({ ...customConfig, take_profit: parseInt(e.target.value) || 15 })}
                          className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {validationErrors.take_profit && (
                          <p className="text-xs text-red-500 mt-1">{validationErrors.take_profit}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Aggression */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Aggression</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Aggression</label>
                    <select
                      value={customConfig.aggression}
                      onChange={(e) => setCustomConfig({ ...customConfig, aggression: e.target.value as ConfigOptions.Aggression })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.AGGRESSION.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.aggression === 'cooldown' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Cooldown Minutes (1-30)</label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={customConfig.cooldown_minutes}
                        onChange={(e) => setCustomConfig({ ...customConfig, cooldown_minutes: parseInt(e.target.value) || 2 })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {validationErrors.cooldown_minutes && (
                        <p className="text-xs text-red-500 mt-1">{validationErrors.cooldown_minutes}</p>
                      )}
                    </div>
                  )}
                  {customConfig.aggression === 'confirmation' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Confirmation Threshold (1-10)</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={customConfig.confirmation_threshold}
                        onChange={(e) => setCustomConfig({ ...customConfig, confirmation_threshold: parseInt(e.target.value) || 2 })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {validationErrors.confirmation_threshold && (
                        <p className="text-xs text-red-500 mt-1">{validationErrors.confirmation_threshold}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Direction & Targeting */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Direction & Targeting</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Direction Bias</label>
                    <select
                      value={customConfig.direction_bias}
                      onChange={(e) => setCustomConfig({ ...customConfig, direction_bias: e.target.value as ConfigOptions.Direction })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.DIRECTION.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Target Selection</label>
                    <select
                      value={customConfig.target_selection}
                      onChange={(e) => setCustomConfig({ ...customConfig, target_selection: e.target.value as ConfigOptions.TargetSelection })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.TARGET_SELECTION.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Timing */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Timing</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Phase Weighting</label>
                    <select
                      value={customConfig.phase_weighting}
                      onChange={(e) => setCustomConfig({ ...customConfig, phase_weighting: e.target.value as ConfigOptions.PhaseWeighting })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.PHASE_WEIGHTING.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Reaction Latency (ms) (0-30000)</label>
                    <input
                      type="number"
                      min="0"
                      max="30000"
                      value={customConfig.reaction_latency_ms}
                      onChange={(e) => setCustomConfig({ ...customConfig, reaction_latency_ms: parseInt(e.target.value) || 3000 })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-foreground/50 mt-1">0 = instant, 2000-5000 = fast, 15000-30000 = delayed</p>
                    {validationErrors.reaction_latency_ms && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.reaction_latency_ms}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Re-entry & Portfolio */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Re-entry & Portfolio</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Re-entry Rule</label>
                    <select
                      value={customConfig.reentry_rule}
                      onChange={(e) => setCustomConfig({ ...customConfig, reentry_rule: e.target.value as ConfigOptions.ReentryRule })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.REENTRY_RULE.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.reentry_rule !== 'no_reentry' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Max Reentries (0-20)</label>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={customConfig.max_reentries}
                        onChange={(e) => setCustomConfig({ ...customConfig, max_reentries: parseInt(e.target.value) || 5 })}
                        className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      {validationErrors.max_reentries && (
                        <p className="text-xs text-red-500 mt-1">{validationErrors.max_reentries}</p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium mb-2">Portfolio Behavior</label>
                    <select
                      value={customConfig.portfolio_behavior}
                      onChange={(e) => setCustomConfig({ ...customConfig, portfolio_behavior: e.target.value as ConfigOptions.PortfolioBehavior })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.PORTFOLIO_BEHAVIOR.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Adaptivity */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Adaptivity</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Adaptivity Mode</label>
                    <select
                      value={customConfig.adaptivity_mode}
                      onChange={(e) => setCustomConfig({ ...customConfig, adaptivity_mode: e.target.value as ConfigOptions.Adaptivity })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ConfigOptions.ADAPTIVITY.map((option) => (
                        <option key={option} value={option}>
                          {option.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {customConfig.adaptivity_mode === 'llm_reflective' && (
                    <p className="text-xs text-foreground/50">
                      LLM Reflective mode hands ongoing control to llmReflection.js for autonomous strategy adjustment.
                    </p>
                  )}
                </div>
              </div>

              {/* Context */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Context Awareness</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={customConfig.context_venue_aware}
                      onChange={(e) => setCustomConfig({ ...customConfig, context_venue_aware: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Venue Aware</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={customConfig.context_weather_aware}
                      onChange={(e) => setCustomConfig({ ...customConfig, context_weather_aware: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Weather Aware</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={customConfig.context_competition_tier_aware}
                      onChange={(e) => setCustomConfig({ ...customConfig, context_competition_tier_aware: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Competition Tier Aware</span>
                  </label>
                </div>
              </div>

              {/* Risk Ceiling */}
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="text-lg font-semibold mb-4">Risk Ceiling (Optional)</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Max Exposure % (0-100)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={customConfig.max_exposure_pct}
                      onChange={(e) => setCustomConfig({ ...customConfig, max_exposure_pct: parseInt(e.target.value) || 100 })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {validationErrors.max_exposure_pct && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.max_exposure_pct}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Max Drawdown Stop % (0-100)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={customConfig.max_drawdown_stop_pct}
                      onChange={(e) => setCustomConfig({ ...customConfig, max_drawdown_stop_pct: parseInt(e.target.value) || 100 })}
                      className="w-full px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {validationErrors.max_drawdown_stop_pct && (
                      <p className="text-xs text-red-500 mt-1">{validationErrors.max_drawdown_stop_pct}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating Agent...' : 'Create Agent'}
            </button>
            <Link
              href="/agents"
              className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-card transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  )
}
